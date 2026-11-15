const { createLocalAccounts } = require('../../../flower.com/lib/local-accounts');
const { scryptSync } = require('node:crypto');
const input = { email:'  BAN@demo  ', password:'matkhau123', name:'Người Dùng', phone:'0901234567', pin:'1234', confirmPin:'1234', questions:[
 {question:'Kỷ niệm đầu tiên?',answer:'hoa phuong do'}, {question:'Nơi yêu thích nhất?',answer:'doi thong xanh'}, {question:'Món ăn yêu thích?',answer:'banh cuon nong'}] };
let now = 1700000000000;
const accounts = createLocalAccounts({ filename:process.argv[2] || ':memory:', now:()=>now });
function clean(result) {
 if(!result) return null;
 const copy = {...result}; if(copy.account) { copy.account={...copy.account}; delete copy.account.uid; }
 if(copy.uid) { delete copy.uid; }
 if(copy.sessionToken) copy.sessionToken=true;
 return copy;
}
if(process.argv[3] === 'seed') {
 const result=accounts.register(input);
 console.log(JSON.stringify({input,token:result.sessionToken,uid:result.account.uid, passwordHash:scryptSync('mật khẩu123',Buffer.alloc(16,7),32,{N:32768,r:8,p:1,maxmem:67108864}).toString('hex'), secretHash:scryptSync('câu trả lời',Buffer.alloc(16,7),32,{N:32768,r:8,p:3,maxmem:67108864}).toString('hex')}));
} else if(process.argv[3] === 'verify') {
 console.log(JSON.stringify(clean(accounts.login({...input,password:'moiMatkhau456'}))));
} else {
 const operations = [
 ['register',input], ['register',input], ['session',{}], ['questions',{...input,name:'sai'}],
 ...Array.from({length:5},()=>['login',{...input,password:'sai'}]), ['login',input],
 ['login',input,900000],
 ...Array.from({length:5},()=>['reset',{...input,pin:'0000',newPassword:'moiMatkhau456'}]),
 ['questions',input], ['reset',{...input,newPassword:'moiMatkhau456'}],
 ['recoverPin',{...input,newPin:'4567',confirmPin:'4567',answers:['sai sai','sai sai','sai sai']}],
 ['recoverPin',{...input,newPin:'4567',confirmPin:'4567',answers:['  HOA   PHUONG DO ','doi thong xanh','banh cuon nong']}],
 ['session',{}], ['login',input], ['changePin',{...input,oldPin:'4567',newPin:'5678',confirmPin:'5678'}],
 ['reset',{...input,pin:'5678',newPassword:'moiMatkhau456'}], ['session',{}],
 ['login',input], ['login',{...input,password:'moiMatkhau456'}], ['logout',{}], ['session',{}],
 ['register',{...input,email:'new@demo',password:'ONLY123456'}], ['register',{...input,email:'new@demo',pin:'1234\n',confirmPin:'1234\n'}],
 ['register',{...input,email:'new@demo',questions:input.questions.map(q=>({...q,answer:'1234567'}))}]
 ];
 let token; const cases=[];
 for(const [method,body,advance=0] of operations) {
   now+=advance; let result;
   try {
    if(method==='session') result=accounts.session(token);
    else if(method==='logout') { accounts.logout([token]); result={}; }
    else if(['changePin','setupSecurity'].includes(method)) result=accounts[method](body,token);
    else result=accounts[method](body,[token]);
    if(result?.sessionToken) token=result.sessionToken;
   } catch(error) {result={status:error.status||500,code:error.code,error:error.message};}
   cases.push({method,body,now,expected:clean(result)});
 }
 console.log(JSON.stringify(cases));
}
accounts.close();
