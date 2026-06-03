import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import supabase from '../config/supabase';
import { env } from '../config/env';
import { encrypt, createAppError, decrypt } from '../utils/crypto';
import {
  RegisterPayload,
  LoginPayload,
  AuthTokens,
  JwtPayload,
  User,
} from '../types';

// ─── JWT ───────────────────────────────────────────────────────

export const generateTokens = (userId: string, email: string): AuthTokens => {
  const payload: JwtPayload = { id: userId, email };
  const accessToken  = jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn } as jwt.SignOptions);
  const refreshToken = jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.refreshExpiresIn } as jwt.SignOptions);
  return { accessToken, refreshToken };
};

// ─── EMAIL/PASSWORD (opcional, para usuarios que prefieran) ────

export const register = async ({ name, email, password }: RegisterPayload) => {
  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email).single();
  if (existing) throw createAppError('Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 12);
  const { data: user, error } = await supabase
    .from('users')
    .insert({ name, email, password_hash })
    .select('id, name, email, avatar_url, created_at')
    .single();

  if (error) throw error;
  return { user, tokens: generateTokens(user.id, user.email) };
};

export const login = async ({ email, password }: LoginPayload) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, avatar_url, password_hash')
    .eq('email', email)
    .single();

  if (error || !user) throw createAppError('Invalid credentials', 401);

  const valid = await bcrypt.compare(password, user.password_hash as string);
  if (!valid) throw createAppError('Invalid credentials', 401);

  const { password_hash: _omit, ...safeUser } = user as User & { password_hash: string };
  return { user: safeUser, tokens: generateTokens(user.id, user.email) };
};

export const refreshAccessToken = (token: string): AuthTokens => {
  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload;
    return generateTokens(payload.id, payload.email);
  } catch {
    throw createAppError('Invalid refresh token', 401);
  }
};

// ─── HELPERS ───────────────────────────────────────────────────

/**
 * Busca un usuario por email o lo crea si no existe.
 * Usado por los callbacks OAuth para login sin registro previo.
 */
const findOrCreateUser = async ({
  email,
  name,
  avatarUrl,
}: {
  email: string;
  name: string;
  avatarUrl?: string;
}): Promise<User> => {
  // Buscar usuario existente
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (existing) return existing as User;

  // Crear usuario nuevo (sin password — solo OAuth)
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ name, email, avatar_url: avatarUrl ?? null })
    .select('*')
    .single();

  if (error) throw error;
  return newUser as User;
};

/**
 * Guarda o actualiza la cuenta conectada de una plataforma
 */
const upsertConnectedAccount = async ({
  userId,
  provider,
  providerUserId,
  accessToken,
  refreshToken,
  expiresIn,
}: {
  userId: string;
  provider: string;
  providerUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) => {
  const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  await supabase.from('connected_accounts').upsert({
    user_id:          userId,
    provider,
    provider_user_id: providerUserId,
    access_token:     encrypt(accessToken),
    refresh_token:    encrypt(refreshToken),
    expires_at,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
};

// ─── SPOTIFY ───────────────────────────────────────────────────

export const getSpotifyAuthUrl = (state?: string): string => {
  const params = new URLSearchParams({
    client_id:     env.spotify.clientId,
    response_type: 'code',
    redirect_uri:  env.spotify.redirectUri,
    scope:         env.spotify.scopes,
    show_dialog:   'true',
    ...(state && { state }),
  });
  return `https://accounts.spotify.com/authorize?${params}`;
};

export const handleSpotifyCallback = async (code: string) => {
  const basicAuth = Buffer.from(
    `${env.spotify.clientId}:${env.spotify.clientSecret}`
  ).toString('base64');

  // 1. Intercambiar code por tokens
  const tokenRes = await axios.post<{
    access_token:  string;
    refresh_token?: string;
    expires_in:    number;
  }>(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: env.spotify.redirectUri,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${basicAuth}`,
      },
    }
  );

  const { access_token, refresh_token, expires_in } = tokenRes.data;

  // 2. Obtener perfil de Spotify
  const profileRes = await axios.get<{
    id:           string;
    display_name: string;
    email:        string;
    images:       { url: string }[];
  }>(
    'https://api.spotify.com/v1/me',
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  const { id: spotifyId, display_name, email, images } = profileRes.data;

  // 3. Crear o recuperar usuario
  const user = await findOrCreateUser({
    email,
    name:      display_name ?? email,
    avatarUrl: images?.[0]?.url,
  });

  // 4. Resolver refresh_token
  let resolvedRefreshToken = refresh_token;

  if (!resolvedRefreshToken) {
    const { data: existing } = await supabase
      .from('connected_accounts')
      .select('refresh_token')
      .eq('user_id', user.id)
      .eq('provider', 'spotify')
      .single();

    if (existing?.refresh_token) {
      resolvedRefreshToken = decrypt(existing.refresh_token as string);
      console.debug('Spotify callback: reusing existing refresh_token');
    } else {
      console.warn('Spotify callback: no refresh_token received and none stored');
    }
  }

  if (!resolvedRefreshToken) {
    throw createAppError(
      'Spotify did not provide a refresh token. Please disconnect and reconnect your account.',
      400
    );
  }

  // 5. Guardar cuenta conectada
  await upsertConnectedAccount({
    userId:         user.id,
    provider:       'spotify',
    providerUserId: spotifyId,
    accessToken:    access_token,
    refreshToken:   resolvedRefreshToken,
    expiresIn:      expires_in,
  });

  // 6. Generar tokens JWT de Tunely
  const tokens = generateTokens(user.id, user.email);

  return { user, tokens };
};

// ─── GOOGLE / YOUTUBE ──────────────────────────────────────────

export const getGoogleAuthUrl = (state?: string): string => {
  const params = new URLSearchParams({
    client_id:     env.google.clientId,
    redirect_uri:  env.google.redirectUri,
    response_type: 'code',
    scope:         env.google.scopes,
    access_type:   'offline',
    prompt:        'consent',
    ...(state && { state }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

export const handleGoogleCallback = async (code: string) => {
  // 1. Intercambiar code por tokens
  const tokenRes = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>('https://oauth2.googleapis.com/token', {
    code,
    client_id:     env.google.clientId,
    client_secret: env.google.clientSecret,
    redirect_uri:  env.google.redirectUri,
    grant_type:    'authorization_code',
  });

  const { access_token, refresh_token, expires_in } = tokenRes.data;

  // 2. Obtener perfil de Google
  const profileRes = await axios.get<{
    sub: string;
    name: string;
    email: string;
    picture: string;
  }>(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  const { sub: googleId, name, email, picture } = profileRes.data;

  // 3. Crear o recuperar usuario
  const user = await findOrCreateUser({ email, name, avatarUrl: picture });

  // 4. Guardar cuenta conectada
  await upsertConnectedAccount({
    userId:         user.id,
    provider:       'google',
    providerUserId: googleId,
    accessToken:    access_token,
    refreshToken:   refresh_token,
    expiresIn:      expires_in,
  });

  // 5. Generar tokens JWT de Tunely
  const tokens = generateTokens(user.id, user.email);

  return { user, tokens };
};
