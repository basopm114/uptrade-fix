from pathlib import Path
import sys
import datetime
import time

path = Path(r"d:\ส่วนตัว\Work for me\uptrade-fix\assets\index-QEPztl5X.js")
text = path.read_text(encoding="utf-8")
start = text.find("const IM=")
end = text.find("Zx.createRoot(document.getElementById(\"root\")).render")
if start == -1 or end == -1 or end <= start:
    sys.exit(f"Bounds not found: start={start}, end={end}")
replacement = (
    "const IM=[],$M=[],Tb={};\n"
    "class tD{constructor(){}initializeDB(){}getAllUsers(){return[]}getUserByEmail(){return null}getUserById(){return null}createUser(){return null}updateUser(){return null}deleteUser(){return!0}validatePassword(){return!1}getAllTrades(){return[]}getTradesByUserId(){return[]}createTrade(e){return {**e,\"docId\":\"trade-\"+str(int(time.time()*1000))}}updateTrade(){return null}deleteTrade(){return!0}clearAllData(){}exportData(){return{\"users\":[],\"trades\":[],\"exportedAt\":datetime.datetime.utcnow().isoformat()+\"Z\"}}}\n"
    "const as=new tD;\n"
    "const eD={help(){console.log(\"Mock DB removed\")}};\n"
    "typeof window<\"u\"&&(window.MockDBDebug=eD);\n"
)
new_text = text[:start] + replacement + text[end:]
path.write_text(new_text, encoding="utf-8")
print(f"Replaced {len(text) - len(new_text)} characters")
