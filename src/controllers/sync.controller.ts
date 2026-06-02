import { Response, NextFunction } from 'express';
import * as syncService from '../services/sync.service';
import { ok } from '../utils/response';
import { AuthRequest, Song, SongCandidate } from '../types';

export const addSong = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await syncService.addSongToPlaylist({
      playlistId: req.params.playlistId,
      songData:   req.body as Partial<Song>,
      userId:     req.user!.id,
    });
    ok(res, result, 'Song added');
  } catch (err) { next(err); }
};

export const confirmMatch = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { song, match } = req.body as { song: Song; match: SongCandidate };
    await syncService.saveMapping(song, match, true);
    await syncService.enqueueSync(song.id, req.params.playlistId, ['spotify', 'youtube']);
    ok(res, {}, 'Match confirmed, sync enqueued');
  } catch (err) { next(err); }
};
