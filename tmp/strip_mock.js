const fs = require('fs');
const path = 'd:\\ส่วนตัว\\Work for me\\uptrade-fix\\assets\\index-QEPztl5X.js';
const marker = 'const IM=';

const text = fs.readFileSync(path, 'utf8');
const start = text.indexOf(marker);
if (start < 0) {
  throw new Error('marker not found');
}

const replacement = 'const IM=[],$M=[],Tb={};class tD{initializeDB(){}getAllUsers(){return[]}getUserByEmail(){return void 0}getUserById(){return void 0}createUser(e){return{id:`user-${Date.now()}`,...e}}updateUser(){return null}deleteUser(){return!0}validatePassword(){return!1}getAllTrades(){return[]}getTradesByUserId(){return[]}createTrade(e){return{...e,docId:`trade-${Date.now()}`}}updateTrade(){return null}deleteTrade(){return!0}clearAllData(){localStorage.removeItem("mockDB_users");localStorage.removeItem("mockDB_trades")}exportData(){return{users:[],trades:[],exportedAt:new Date().toISOString()}}}const as=new tD;if(typeof window!=="undefined"){window.MockDBDebug={help(){console.log("Mock DB removed")}}}Zx.createRoot(document.getElementById("root")).render(_.jsx(ht.StrictMode,{children:_.jsx(WM,{})}));(function(){try{IM.length=0;$M.length=0;Object.keys(Tb||{}).forEach(k=>delete Tb[k]);localStorage.removeItem("mockDB_users");localStorage.removeItem("mockDB_trades");if(typeof as!=="undefined"){as.getAllUsers=()=>[];as.getUserByEmail=()=>void 0;as.getUserById=()=>void 0;as.getAllTrades=()=>[];as.getTradesByUserId=()=>[];as.createTrade=e=>({...e,docId:`trade-${Date.now()}`});as.updateTrade=()=>null;as.deleteTrade=()=>!0;as.validatePassword=()=>!1;as.clearAllData=()=>{localStorage.removeItem("mockDB_users");localStorage.removeItem("mockDB_trades")};as.exportData=()=>({users:[],trades:[],exportedAt:new Date().toISOString()})}if(typeof window!=="undefined"){window.MockDBDebug={help(){console.log("Mock DB removed")}}}}catch(e){console.error("Mock data cleanup failed",e)}})();';

fs.writeFileSync(path, text.slice(0, start) + replacement, 'utf8');
console.log('strip done');
