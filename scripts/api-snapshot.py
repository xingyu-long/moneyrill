# Regression snapshot of the HTTP API (read-only calls plus rejected requests; never creates data).
# Before a refactor:  python3 scripts/api-snapshot.py 3002 baseline
# After deploying:    python3 scripts/api-snapshot.py 3002 compare   (3003 = production)
# Hashes stand in for financial data, so the saved file holds no balances.
import json,sys,hashlib,urllib.request,urllib.error,os
port=sys.argv[1];mode=sys.argv[2]
base=f'http://localhost:{port}'
VOLATILE={'last_synced','provider_as_of','observed_at','started_at','finished_at','computed_at','exportedAt','id'}
def call(path,method='GET',body=None,headers=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json',**(headers or {})})
    try:
        r=urllib.request.urlopen(req,timeout=40);return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:
        return e.code,dict(e.headers),e.read()
def strip(o,top=True):
    if isinstance(o,dict): return {k:strip(v,False) for k,v in o.items() if k not in VOLATILE or (k=='id' and top is False and False)}
    if isinstance(o,list): return [strip(x,False) for x in o]
    return o
snap={}
def h(x): return hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()[:12]
s,hd,b=call('/api/health');snap['health']=[s,json.loads(b)]
s,hd,b=call('/api/overview');d=json.loads(b)
snap['overview.status']=s
for k,v in d.items():
    if k=='runs': snap['overview.runs.len']=min(len(v),8);continue
    snap['overview.'+k]=h(strip(v)) if isinstance(v,(list,dict)) else v
    if isinstance(v,list): snap['overview.'+k+'.len']=len(v)
s,hd,b=call('/api/export');d=json.loads(b);snap['export']=[s,d['version'],d['environment'],{t:h(strip(rows)) for t,rows in d['tables'].items()},hd.get('Content-Disposition')]
s,hd,b=call('/api/export.csv');snap['csv']=[s,hd.get('Content-Type'),hd.get('Content-Disposition'),hashlib.sha256(b).hexdigest()[:12]]
s,hd,b=call('/api/nope');snap['404']=[s,b.decode()]
s,hd,b=call('/api/overview',headers={'Origin':'https://example.com'});snap['cross-origin']=[s,b.decode()]
s,hd,b=call('/api/overview',headers={'Host':'evil.example'});snap['bad-host']=[s,b.decode()]
s,hd,b=call('/api/accounts','POST',{'name':'','kind':'cash','balance':'1'});snap['bad-account']=[s,b.decode()]
s,hd,b=call('/api/accounts/does-not-exist','PATCH',{'included':False});snap['patch-missing']=[s,b.decode()]
s,hd,b=call('/api/import','POST',{'version':2});snap['bad-import']=[s,b.decode()]
s,hd,b=call('/api/exchange','POST',{'public_token':'public-sandbox-bad' if port=='3003' else 'public-production-bad'});snap['bad-exchange']=[s,b.decode()]
s,hd,b=call('/api/connections/nope/disconnect','POST',{});snap['disconnect-missing']=[s,b.decode()]
s,hd,b=call('/');snap['index']=[s,hd.get('Content-Type')]
if port=='3003':
    s,hd,b=call('/api/sandbox-samples','POST',{});snap['samples']=[s,b.decode()]
f=f'.api-snapshot-{port}.json'
if mode=='baseline':
    json.dump(snap,open(f,'w'),indent=1,sort_keys=True);print('saved',len(snap),'checks')
else:
    base_=json.load(open(f));diffs=[k for k in set(base_)|set(snap) if base_.get(k)!=snap.get(k)]
    print(json.dumps({'checks':len(snap),'differences':len(diffs),'diff':{k:{'before':base_.get(k),'after':snap.get(k)} for k in diffs[:5]}},indent=1)[:1500])
