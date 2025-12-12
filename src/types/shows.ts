import { MarketParams, PaginationParams } from './common.js';

export interface ShowArgs extends MarketParams {
  id: string;
}

export interface ShowEpisodesArgs extends MarketParams, PaginationParams {
  id: string;
}

