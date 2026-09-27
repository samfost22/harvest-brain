// npm run backup  ->  a complete, consistent copy of the cellar in data/backups/, safe while the app runs.
import { backup, count, getDb } from './db.js';

getDb();
const file = backup();
console.log(`Backed up ${count('batches')} batches to ${file}`);
