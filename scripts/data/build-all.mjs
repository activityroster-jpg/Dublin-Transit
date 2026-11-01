// Full data rebuild: timetable -> network -> world. Downloads are cached in data-raw/.
// Locally behind a proxy run with NODE_USE_ENV_PROXY=1.
import { buildTimetable } from './build-timetable.mjs';
import { buildNetwork } from './build-network.mjs';
import { fetchCorridor } from './fetch-corridor.mjs';
import { buildWorld } from './build-world.mjs';

await buildTimetable();
await fetchCorridor();
await buildNetwork();
await buildWorld();
console.log('data build complete');
