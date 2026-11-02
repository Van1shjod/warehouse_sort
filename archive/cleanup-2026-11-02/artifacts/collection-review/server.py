"""Local UI fixture, isolated from the real warehouse database."""
import sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from test_collection import CollectionTests
case=CollectionTests()
case.setUp()
from flask import session,redirect
@case.app.get('/_test/enter')
def enter():
    session.update(user_id=1,role='admin',username='Demo')
    return redirect('/dashboard')
case.app.run(host='127.0.0.1',port=int(os.environ.get('COLLECTION_TEST_PORT','5082')),debug=False)
