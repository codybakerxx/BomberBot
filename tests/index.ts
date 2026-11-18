/**
 * Runs every check. Each file below throws on the first thing that is wrong,
 * so reaching the last line means everything passed.
 * Run with: npm test
 */
import './rules.test';
import './swipe.test';
import './bot.test';
import './dances.test';
import './lives.test';
import './room.test';
import './predict.test';
import './push.test';
import './friends.test';
import './page.test';

console.log('all checks passed');
