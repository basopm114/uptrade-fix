from pathlib import Path

path = Path(r"d:\ส่วนตัว\Work for me\uptrade-fix\assets\index-QEPztl5X.js")
text = path.read_text(encoding="utf-8")
marker = "const IM="
if marker not in text:
    raise SystemExit("marker not found")
start = text.index(marker)

replacement = (
    "const IM=[],$M=[],Tb={};"
    "class tD{initializeDB(){}getAllUsers(){return[]}getUserByEmail(){return void 0}"
    "getUserById(){return void 0}createUser(e){return{id:`user-${Date.now()}`,...e}}"
    "updateUser(){return null}deleteUser(){return!0}validatePassword(){return!1}"
    "getAllTrades(){return[]}getTradesByUserId(){return[]}createTrade(e){return{...e,docId:`trade-${Date.now()}`}}"
    "updateTrade(){return null}deleteTrade(){return!0}"
    "clearAllData(){localStorage.removeItem(\"mockDB_users\");localStorage.removeItem(\"mockDB_trades\")}"
    "exportData(){return{users:[],trades:[],exportedAt:new Date().toISOString()}}}"
    "const as=new tD;"
    "if(typeof window<\"u\"){window.MockDBDebug={help(){console.log(\"Mock DB removed\")}}}"
    "Zx.createRoot(document.getElementById(\"root\")).render(_.jsx(ht.StrictMode,{children:_.jsx(WM,{})}));"
    "(function(){try{IM.length=0;$M.length=0;Object.keys(Tb||{}).forEach(k=>delete Tb[k]);"
    "localStorage.removeItem(\"mockDB_users\");localStorage.removeItem(\"mockDB_trades\");"
    "if(typeof as<\"u\"){as.getAllUsers=()=>[];as.getUserByEmail=()=>void 0;as.getUserById=()=>void 0;"
    "as.getAllTrades=()=>[];as.getTradesByUserId=()=>[];as.createTrade=e=>({...e,docId:`trade-${Date.now()}`});"
    "as.updateTrade=()=>null;as.deleteTrade=()=>!0;as.validatePassword=()=>!1;"
    "as.clearAllData=()=>{localStorage.removeItem(\"mockDB_users\");localStorage.removeItem(\"mockDB_trades\")};"
    "as.exportData=()=>({users:[],trades:[],exportedAt:new Date().toISOString()})}"
    "if(typeof window<\"u\"){window.MockDBDebug={help(){console.log(\"Mock DB removed\")}}}}"
    "catch(e){console.error(\"Mock data cleanup failed\",e)}})();"
)

path.write_text(text[:start] + replacement, encoding="utf-8")
print("updated", path)
