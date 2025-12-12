import { SpotifyApi } from '../utils/api.js';
import { ShowArgs, ShowEpisodesArgs } from '../types/shows.js';

export class ShowsHandler {
  constructor(private api: SpotifyApi) {}

  private extractShowId(id: string): string {
    return id.startsWith('spotify:show:') ? id.split(':')[2] : id;
  }

  async getShow(args: ShowArgs) {
    const showId = this.extractShowId(args.id);
    const { market } = args;

    const params = { market };
    return this.api.makeRequest(
      `/shows/${showId}${this.api.buildQueryString(params)}`
    );
  }

  async getShowEpisodes(args: ShowEpisodesArgs) {
    const showId = this.extractShowId(args.id);
    const { market, limit, offset } = args;

    const params = {
      market,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset })
    };

    return this.api.makeRequest(
      `/shows/${showId}/episodes${this.api.buildQueryString(params)}`
    );
  }
}

