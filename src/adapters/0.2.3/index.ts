import { makePatchAdapter } from '../patch-adapter.js';
import { client } from './client.js';
export const adapter = makePatchAdapter(client);
