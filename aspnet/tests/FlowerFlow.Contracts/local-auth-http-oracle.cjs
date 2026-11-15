const { createLocalAuthHandler } = require('../../../flower.com/lib/local-auth-http');
const codes=['invalid-credential','account-locked','password-reset-required','invalid-recovery','pin-reset-required','pin-format-update-required','invalid-answers','invalid-security-proof','session-required','security-setup-required','security-already-configured','answers-locked','invalid-recovery-code','recovery-locked'];
(async()=>{
 const cases=[];
 for(const code of codes) {
  const result={status:code.includes('locked')?429:401,code,attemptsRemaining:0,...(code.includes('locked')?{retryAfter:900}:{})};
  const handler=createLocalAuthHandler({login:async()=>result});
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(s){this.statusCode=s;return this},json(body){this.body=body}};
  await handler('login',{method:'POST',headers:{},body:{}},res);
  cases.push({result,status:res.statusCode,body:res.body,retry:res.headers['retry-after']||null,cleared:!!res.headers['set-cookie']});
 }
 console.log(JSON.stringify(cases));
})();
