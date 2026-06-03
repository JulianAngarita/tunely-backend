// ─── ENUMS ────────────────────────────────────────────────────

export type Provider = 'spotify' | 'google';
export type MemberRole = 'owner' | 'admin' | 'member';
export type SyncStatus = 'pending' | 'processing' | 'done' | 'failed';
export type SyncPlatform = 'spotify' | 'youtube';
export type AvailabilityStatus = 'both' | 'spotify_only' | 'youtube_only' | 'uncertain' | 'not_found';
export type ConflictType = 'deleted_externally' | 'not_available' | 'token_expired';
export type ActivityAction =
  | 'song_added'
  | 'song_removed'
  | 'member_joined'
  | 'member_removed'
  | 'playlist_edited'
  | 'sync_completed'
  | 'sync_failed'
  | 'song_unavailable';

// ─── DATABASE MODELS ──────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectedAccount {
  id: string;
  user_id: string;
  provider: Provider;
  provider_user_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  is_public: boolean;
  cover_url?: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface PlaylistMember {
  playlist_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration_ms?: number;
  spotify_track_id?: string;
  youtube_video_id?: string;
  availability_status: AvailabilityStatus;
  created_at: string;
  cover_url: string;
}

export interface PlaylistSong {
  id: string;
  playlist_id: string;
  song_id: string;
  added_by?: string;
  added_at: string;
  position?: number;
}

export interface SongMapping {
  id: string;
  spotify_track_id?: string;
  youtube_video_id?: string;
  match_score: number;
  confirmed_by_user: boolean;
  matched_at: string;
}

export interface SyncQueueItem {
  id: string;
  song_id: string;
  playlist_id: string;
  platform: SyncPlatform;
  status: SyncStatus;
  retry_count: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface SongConflict {
  id: string;
  song_id: string;
  playlist_id?: string;
  platform: SyncPlatform;
  conflict_type: ConflictType;
  resolved: boolean;
  resolved_by?: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  playlist_id?: string;
  user_id?: string;
  action: ActivityAction;
  details?: Record<string, unknown>;
  created_at: string;
}

// ─── SERVICE PAYLOADS ─────────────────────────────────────────

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface JwtPayload {
  id: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CreatePlaylistPayload {
  name: string;
  description?: string;
  isPublic?: boolean;
  coverUrl?: string;
  ownerId: string;
}

export interface AddSongPayload {
  playlistId: string;
  songData: Partial<Song>;
  userId: string;
}

// ─── MATCHING ─────────────────────────────────────────────────

export interface SongCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration_ms?: number;
  popularity?: number;
  platform: SyncPlatform;
  cover_url?: string;
  score?: number;
}

export interface MatchResult {
  best: SongCandidate | null;
  suggestions: SongCandidate[];
  autoMatch: boolean;
}

// ─── EXPRESS EXTENSIONS ───────────────────────────────────────

import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: JwtPayload;
  membership?: PlaylistMember;
}
