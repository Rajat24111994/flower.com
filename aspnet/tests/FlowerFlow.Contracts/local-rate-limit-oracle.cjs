const { createLocalRateLimit } = require('../../../flower.com/lib/local-rate-limit');
let now = 1000;
const limit = createLocalRateLimit({ now: () => now, capacity: 2 });
const inputs = [['a',2,1501],['a',2,1501],['a',2,1501],['b',1,4000],['c',1,4000],
 ['a',2,1501,2500],['a',2,1501,2501],['c',1,1000],['b',1,4000,5000],['c',1,1000]];
console.log(JSON.stringify(inputs.map(args => { if(args.length === 4) now=args[3]; return { now, key:args[0], maximum:args[1], duration:args[2], expected:limit(...args) }; })));
