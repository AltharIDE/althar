var names = ['console','print','setTimeout','clearTimeout','setInterval','setImmediate','clearImmediate','queueMicrotask','TextEncoder','TextDecoder','structuredClone','crypto','AbortController','AbortSignal','URL','URLSearchParams','WebSocket','fetch','Blob','MessageChannel','performance','process','WeakRef','FinalizationRegistry','Intl','BigInt','Proxy','Reflect','Symbol.asyncIterator','Symbol.dispose','Symbol.asyncDispose','Error.captureStackTrace','Promise.withResolvers','Array.prototype.at','Array.fromAsync','Object.hasOwn','String.prototype.replaceAll','Array.prototype.findLast','globalThis','HermesInternal'];
var out = [];
for (var i = 0; i < names.length; i++) {
  var n = names[i], v;
  try { v = n.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, globalThis); } catch (e) { v = undefined; }
  out.push(n + '=' + (typeof v));
}
(typeof print === 'function' ? print : console.log)(out.join('\n'));
