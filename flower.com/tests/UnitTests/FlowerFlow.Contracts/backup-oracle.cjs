const fs = require('node:fs');
const { encryptBackup, decryptBackup } = require('../../../lib/firestore-backup');
const backup={format:'flowerflow-backup-v1',createdAt:'2026-11-15T00:00:00.000Z',collections:{items:{one:{title:'Hoa 🌸',quantity:3,amount:1.25,nested:[null,true,{__type:'bytes',value:'AQID'}]}},'items/one/events':{event:{title:'Nested event'}}}};
if(process.argv[2]) console.log(JSON.stringify(decryptBackup(fs.readFileSync(process.argv[2],'utf8'),'mật khẩu sao lưu123')));
else console.log(JSON.stringify({backup,encrypted:encryptBackup(backup,'mật khẩu sao lưu123')}));
