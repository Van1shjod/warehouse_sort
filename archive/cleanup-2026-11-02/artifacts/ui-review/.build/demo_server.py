"""Isolated presentation fixture; never initializes or writes production storage."""
import os, sys, sqlite3, secrets, json, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
BUILD = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
fixture = BUILD / 'demo.db'
if not fixture.exists():
    source = sqlite3.connect((ROOT / 'warehouse.db').as_uri() + '?mode=ro', uri=True)
    schema = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").fetchall()
    source.close()
    target = sqlite3.connect(fixture)
    for (sql,) in schema:
        target.execute(sql)
    target.commit()
    target.close()
import database
OriginalDatabase = database.Database
database.Database = lambda *args, **kwargs: OriginalDatabase(str(fixture))
os.chdir(BUILD)
import app as site
from flask import session, redirect, send_file
db = site.db
conn = db.get_connection()
if not conn.execute("SELECT 1 FROM users WHERE username='Оператор 1'").fetchone():
    for name in ['Оператор 1', 'Оператор 2', 'Оператор 3']:
        db.create_user(name, secrets.token_urlsafe(24))
    conn.execute("UPDATE users SET username='Адміністратор' WHERE id=1")
    conn.execute("UPDATE users SET total_cartons=CASE id WHEN 2 THEN 86 WHEN 3 THEN 64 ELSE 42 END, last_activity=datetime('now')")
    conn.execute("INSERT INTO containers(id,container_number,status) VALUES(1,'DEMO-2026-10','active')")
    conn.execute("INSERT INTO sorts(id,name,type,unload_date,description,status,created_by,mode) VALUES(1,'Zona Single A','single,mix,vevor','2026-10-22','Демонстраційне сортування','active',1,'sort'),(2,'Rampa 1','single,mix,vevor','2026-10-22','Демонстраційне розвантаження','active',1,'presort'),(3,'Rampa 2','single,mix,vevor','2026-10-22','Завершений Pre-sort','closed',1,'presort'),(4,'Zona Mix B','single,mix,vevor','2026-10-22','Сортування після Pre-sort','active',1,'sort')")
    for cid, sid in [(2,2),(3,3),(4,4)]:
        conn.execute("INSERT INTO containers(id,container_number,status) VALUES(?,?,'active')", (cid,'DEMO-PRESORT-'+str(cid)))
        conn.execute('INSERT INTO presort_jobs VALUES(?,?)',(sid,cid))
        for n in range(1,4):
            pid = cid*10+n
            conn.execute("INSERT INTO presort_pallets(id,container_id,number,user_id,closed_at) VALUES(?,?,?,?,?)",(pid,cid,n,2 if n!=2 else 3,None if cid==2 and n==3 else '2026-10-22 10:20:00'))
            for k in range(6+n*2):
                conn.execute("INSERT INTO presort_scans(pallet_id,user_id,type,code,location,pack,request_id) VALUES(?,?,?,?,?,?,?)",(pid,2,'single' if k%3 else 'mix','4567' if k%3 else 'D980989','JP-A' if k%3 else '',30 if k%3 else 0,secrets.token_hex(16)))
    for i,(code,kind,total,current,loc) in enumerate([('4567','single',30,18,'JP-A'),('7821','single',24,24,'IZ-A'),('D980989','mix',0,16,''),('2189','vevor',20,12,'AB-C')],1):
        conn.execute("INSERT INTO icc_codes(id,icc_code,type,total_cartons,current_cartons,last_4_digits,location_code,sort_id,is_completed) VALUES(?,?,?,?,?,?,?,?,?)",(i,code,kind,total,current,code[-4:],loc,1,int(total>0 and current==total)))
        conn.execute("INSERT INTO pallets(pallet_number,icc_code_id,user_id,type,cartons_count,is_closed) VALUES(?,?,?,?,?,?)",('A-'+str(i).zfill(3),i,2,kind,current,int(i==2)))
    conn.commit()
    for action,details in [('login','Вхід в систему'),('select_sort','Обрано Zona Single A'),('add_cartons','4567: додано 6 картонів, палета A-001'),('close_pallet','Закрито палету A-002'),('create_sort','Створено Pre-sort Rampa 1')]:
        db.log_activity(2,action,details)
conn.close()
# Use copies of actual label photographs and their existing OCR results.
for kind in ['single','mix']:
    src = ROOT / 'ocr_training_data' / kind / 'results'
    for file in sorted(src.glob('*_result.json'))[-2:]:
        data = json.loads(file.read_text(encoding='utf-8'))
        original = ROOT / data.get('image_path','')
        if not original.is_file():
            continue
        dest = BUILD / 'ocr_training_data' / kind / 'images' / original.name
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(original,dest)
        data['image_path']=dest.relative_to(BUILD).as_posix()
        data['user_id']=2
        result = BUILD / 'ocr_training_data' / kind / 'results' / file.name
        result.parent.mkdir(parents=True,exist_ok=True)
        result.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
@site.app.get('/_presentation/enter/<int:uid>')
def demo_enter(uid):
    user=db.get_user_by_id(uid)
    session.update(user_id=uid,username=user['username'],role=user['role'])
    return redirect('/dashboard')
# Flask resolves relative send_file paths against the application root.
@site.app.get('/_presentation/image/<kind>/<name>')
def demo_image(kind,name):
    return send_file(BUILD/'ocr_training_data'/kind/'images'/name)
site.app.run(host='127.0.0.1',port=5081,debug=False)

