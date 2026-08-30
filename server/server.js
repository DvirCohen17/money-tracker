import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'moneytracker.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
const backupDir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
function createDbBackup(){
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const target=path.join(backupDir, `moneytracker-${stamp}.db`);
    fs.copyFileSync(dbPath,target);
    const files=fs.readdirSync(backupDir).filter(x=>x.endsWith('.db')).sort();
    for(const f of files.slice(0,Math.max(0,files.length-7))) fs.rmSync(path.join(backupDir,f),{force:true});
  } catch(e){ console.warn('DB backup failed',e.message); }
}
app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..')));

// The DB is persistent on the host. WAL + periodic checkpoint keeps writes durable.
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS households(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS household_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  UNIQUE(household_id,name)
);
CREATE TABLE IF NOT EXISTS household_data(
  household_id INTEGER PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_data(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Migrate the v1.1 schema: every login account gets one private household and
// its existing state is moved into that household. No endpoint ever lists all users.
function migrateLegacyAccounts() {
  const users = db.prepare('SELECT id,name,created_at FROM users').all();
  const now = new Date().toISOString();
  const getHousehold = db.prepare('SELECT id FROM households WHERE owner_user_id=?');
  const insertHousehold = db.prepare('INSERT INTO households(owner_user_id,created_at,updated_at) VALUES(?,?,?)');
  const insertMember = db.prepare('INSERT OR IGNORE INTO household_members(household_id,name,role,created_at) VALUES(?,?,?,?)');
  const getLegacy = db.prepare('SELECT state_json,updated_at FROM user_data WHERE user_id=?');
  const insertData = db.prepare('INSERT OR IGNORE INTO household_data(household_id,state_json,updated_at) VALUES(?,?,?)');
  const tx = db.transaction(() => {
    for (const u of users) {
      let h = getHousehold.get(u.id);
      if (!h) {
        const info = insertHousehold.run(u.id, u.created_at || now, now);
        h = { id: Number(info.lastInsertRowid) };
      }
      insertMember.run(h.id, u.name || 'המשתמש שלי', 'owner', u.created_at || now);
      const legacy = getLegacy.get(u.id);
      if (legacy) insertData.run(h.id, legacy.state_json || '{}', legacy.updated_at || now);
      else insertData.run(h.id, '{}', now);
    }
  });
  tx();
}
migrateLegacyAccounts();

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = jwt.verify(token, JWT_SECRET);
    const h = db.prepare('SELECT id,owner_user_id FROM households WHERE id=?').get(payload.householdId);
    if (!h || Number(h.owner_user_id) !== Number(payload.id)) throw new Error('invalid household');
    req.user = payload;
    req.householdId = h.id;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

function userView(id) {
  return db.prepare('SELECT id,email,name,created_at AS createdAt FROM users WHERE id=?').get(id);
}
function householdView(householdId) {
  return db.prepare('SELECT id,name,role,created_at AS createdAt FROM household_members WHERE household_id=? ORDER BY id').all(householdId);
}
function ensureHouseholdData(householdId) {
  const row = db.prepare('SELECT state_json,updated_at FROM household_data WHERE household_id=?').get(householdId);
  if (row) return row;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO household_data(household_id,state_json,updated_at) VALUES(?,?,?)').run(householdId, '{}', now);
  return { state_json: '{}', updated_at: now };
}

app.post('/api/register', (req,res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({error:'missing fields'});
  if (String(password).length < 6) return res.status(400).json({error:'password too short'});
  try {
    const now = new Date().toISOString();
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare('INSERT INTO users(email,name,password_hash,created_at) VALUES(?,?,?,?)').run(String(email).trim().toLowerCase(), String(name).trim(), hash, now);
    const id = Number(info.lastInsertRowid);
    const hInfo = db.prepare('INSERT INTO households(owner_user_id,created_at,updated_at) VALUES(?,?,?)').run(id, now, now);
    const householdId = Number(hInfo.lastInsertRowid);
    db.prepare('INSERT INTO household_members(household_id,name,role,created_at) VALUES(?,?,?,?)').run(householdId, String(name).trim(), 'owner', now);
    db.prepare('INSERT INTO household_data(household_id,state_json,updated_at) VALUES(?,?,?)').run(householdId, '{}', now);
    res.status(201).json({ok:true, user:userView(id)});
  } catch (e) {
    res.status(409).json({error:'email already exists'});
  }
});

app.post('/api/login', (req,res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT id,name,email,password_hash FROM users WHERE email=?').get(String(email||'').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password||'', u.password_hash)) return res.status(401).json({error:'invalid credentials'});
  let h = db.prepare('SELECT id FROM households WHERE owner_user_id=?').get(u.id);
  if (!h) {
    const now = new Date().toISOString();
    const hi = db.prepare('INSERT INTO households(owner_user_id,created_at,updated_at) VALUES(?,?,?)').run(u.id,now,now);
    h={id:Number(hi.lastInsertRowid)};
    db.prepare('INSERT OR IGNORE INTO household_members(household_id,name,role,created_at) VALUES(?,?,?,?)').run(h.id,u.name,'owner',now);
    ensureHouseholdData(h.id);
  }
  const token = jwt.sign({id:u.id,name:u.name,email:u.email,householdId:h.id}, JWT_SECRET, {expiresIn:'30d'});
  res.json({token,user:{...userView(u.id),householdId:h.id},household:householdView(h.id)});
});

app.get('/api/me', auth, (req,res) => res.json({...userView(req.user.id), householdId:req.householdId}));
app.put('/api/me', auth, (req,res) => {
  const name=String(req.body?.name||'').trim();
  const email=String(req.body?.email||'').trim().toLowerCase();
  if(!name||!email)return res.status(400).json({error:'missing fields'});
  try{
    db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name,email,req.user.id);
    db.prepare("UPDATE household_members SET name=? WHERE household_id=? AND role='owner'").run(name,req.householdId);
    const h=new Date().toISOString();db.prepare('UPDATE households SET updated_at=? WHERE id=?').run(h,req.householdId);
    res.json({user:{...userView(req.user.id),householdId:req.householdId},household:householdView(req.householdId)});
  }catch{res.status(409).json({error:'email already exists'});}
});

app.get('/api/household', auth, (req,res)=>res.json({members:householdView(req.householdId)}));
app.post('/api/household/members', auth, (req,res)=>{
  const name=String(req.body?.name||'').trim();
  if(!name)return res.status(400).json({error:'name required'});
  if(name.length>80)return res.status(400).json({error:'name too long'});
  try{
    const info=db.prepare('INSERT INTO household_members(household_id,name,role,created_at) VALUES(?,?,?,?)').run(req.householdId,name,'member',new Date().toISOString());
    res.status(201).json({member:db.prepare('SELECT id,name,role,created_at AS createdAt FROM household_members WHERE id=?').get(info.lastInsertRowid),members:householdView(req.householdId)});
  }catch{res.status(409).json({error:'member already exists'});}
});
app.put('/api/household/members/:id', auth, (req,res)=>{
  const name=String(req.body?.name||'').trim();const id=Number(req.params.id);
  if(!name)return res.status(400).json({error:'name required'});
  const member=db.prepare('SELECT id,role FROM household_members WHERE id=? AND household_id=?').get(id,req.householdId);
  if(!member)return res.status(404).json({error:'member not found'});
  db.prepare('UPDATE household_members SET name=? WHERE id=? AND household_id=?').run(name,id,req.householdId);
  res.json({members:householdView(req.householdId)});
});
app.delete('/api/household/members/:id', auth, (req,res)=>{
  const id=Number(req.params.id);const member=db.prepare('SELECT role FROM household_members WHERE id=? AND household_id=?').get(id,req.householdId);
  if(!member)return res.status(404).json({error:'member not found'});
  if(member.role==='owner')return res.status(400).json({error:'owner cannot be removed'});
  db.prepare('DELETE FROM household_members WHERE id=? AND household_id=?').run(id,req.householdId);
  res.json({members:householdView(req.householdId)});
});

app.get('/api/state', auth, (req,res)=>{
  const row=ensureHouseholdData(req.householdId);
  res.json({state:JSON.parse(row.state_json||'{}'),updatedAt:row.updated_at});
});
app.put('/api/state', auth, (req,res)=>{
  const state=req.body?.state;
  if(!state||typeof state!=='object')return res.status(400).json({error:'invalid state'});
  const clientUpdatedAt=req.body?.updatedAt?String(req.body.updatedAt):null;
  const current=ensureHouseholdData(req.householdId);
  // Last-write-wins is intentional for this small shared household app. Every
  // client polls the server, so another device receives the newest state quickly.
  const now=new Date().toISOString();
  db.prepare('UPDATE household_data SET state_json=?,updated_at=? WHERE household_id=?').run(JSON.stringify(state),now,req.householdId);
  db.prepare('UPDATE households SET updated_at=? WHERE id=?').run(now,req.householdId);
  res.json({ok:true,updatedAt:now,previousUpdatedAt:current.updated_at,clientUpdatedAt});
});

const subscriptionCatalog={
  netflix:{name:'Netflix',category:'סטרימינג',source:'https://www.netflix.com/il/',plans:[{id:'basic',name:'בסיסית',amount:32.90},{id:'standard',name:'סטנדרטית',amount:54.90},{id:'premium',name:'פרימיום',amount:69.90}]},
  spotify:{name:'Spotify',category:'מוזיקה',source:'https://www.spotify.com/il-he/premium/',plans:[{id:'individual',name:'יחיד/ה',amount:23.90},{id:'student',name:'סטודנטים',amount:12.90},{id:'duo',name:'זוג',amount:33.90},{id:'family',name:'משפחה',amount:39.90}]},
  disneyplus:{name:'Disney+',category:'סטרימינג',source:'https://www.disneyplus.com/',plans:[{id:'standard',name:'Standard',amount:49.90},{id:'premium',name:'Premium',amount:69.90}]},
  appleicloud:{name:'iCloud+',category:'אחסון ענן',source:'https://www.apple.com/il/icloud/',plans:[{id:'50gb',name:'50GB',amount:3.90},{id:'200gb',name:'200GB',amount:11.90},{id:'2tb',name:'2TB',amount:39.90}]},
  googleone:{name:'Google One',category:'אחסון ענן',source:'https://one.google.com/intl/iw_il/about/',plans:[{id:'100gb',name:'100GB',amount:9.90},{id:'200gb',name:'200GB',amount:14.90},{id:'2tb',name:'2TB',amount:49.90}]},
  amazonprime:{name:'Amazon Prime',category:'קניות/סטרימינג',source:'https://www.amazon.com/prime',plans:[{id:'prime',name:'Prime',amount:35}]},
  youtube:{name:'YouTube Premium',category:'וידאו',source:'https://www.youtube.com/premium',plans:[{id:'individual',name:'יחיד/ה',amount:29.90},{id:'family',name:'משפחה',amount:59.90}]},
  microsoft365:{name:'Microsoft 365',category:'תוכנה',source:'https://www.microsoft.com/he-il/microsoft-365',plans:[{id:'personal',name:'Personal',amount:42},{id:'family',name:'Family',amount:52}]},
  dropbox:{name:'Dropbox',category:'אחסון ענן',source:'https://www.dropbox.com/buy',plans:[{id:'plus',name:'Plus 2TB',amount:36.90},{id:'family',name:'Family',amount:62.90}]},
  adobe:{name:'Adobe Creative Cloud',category:'תוכנה',source:'https://www.adobe.com/il_he/creativecloud/campaign/pricing.html',plans:[{id:'photo',name:'צילום',amount:105},{id:'single',name:'יישום יחיד',amount:119},{id:'pro',name:'Creative Cloud Pro',amount:360}]},
  canva:{name:'Canva',category:'עיצוב',source:'https://www.canva.com/pricing/',plans:[{id:'pro',name:'Pro',amount:55},{id:'business',name:'Business',amount:85}]},
  chatgpt:{name:'ChatGPT',category:'AI',source:'https://chatgpt.com/pricing/',plans:[{id:'plus',name:'Plus',amount:75},{id:'pro',name:'Pro',amount:750}]},
  claude:{name:'Claude',category:'AI',source:'https://www.anthropic.com/pricing',plans:[{id:'pro',name:'Pro',amount:75}]},
  notion:{name:'Notion',category:'פרודוקטיביות',source:'https://www.notion.com/pricing',plans:[{id:'plus',name:'Plus',amount:40},{id:'business',name:'Business',amount:80}]},
  zoom:{name:'Zoom',category:'פרודוקטיביות',source:'https://zoom.us/pricing',plans:[{id:'pro',name:'Pro',amount:65}]},
  strava:{name:'Strava',category:'כושר',source:'https://www.strava.com/subscribe',plans:[{id:'individual',name:'מנוי',amount:29.90}]},
  xbox:{name:'Xbox Game Pass',category:'גיימינג',source:'https://www.xbox.com/he-IL/xbox-game-pass',plans:[{id:'essential',name:'Essential',amount:29.90},{id:'premium',name:'Premium',amount:59.90},{id:'ultimate',name:'Ultimate',amount:89.90}]},
  playstation:{name:'PlayStation Plus',category:'גיימינג',source:'https://www.playstation.com/he-il/ps-plus/',plans:[{id:'essential',name:'Essential',amount:32.90},{id:'extra',name:'Extra',amount:54.90},{id:'deluxe',name:'Deluxe',amount:69.90}]},
  nordvpn:{name:'NordVPN',category:'אבטחה',source:'https://nordvpn.com/pricing/',plans:[{id:'standard',name:'Standard',amount:55},{id:'plus',name:'Plus',amount:65}]},
  grammarly:{name:'Grammarly',category:'פרודוקטיביות',source:'https://www.grammarly.com/plans',plans:[{id:'pro',name:'Pro',amount:60}]},
  linkedin:{name:'LinkedIn Premium',category:'קריירה',source:'https://www.linkedin.com/premium/',plans:[{id:'career',name:'Career',amount:120}]},
  duolingo:{name:'Duolingo',category:'לימודים',source:'https://www.duolingo.com/super',plans:[{id:'super',name:'Super',amount:55}]},
  fitness:{name:'חדר כושר',category:'כושר',source:'',plans:[{id:'monthly',name:'חודשי',amount:190}]}
};
app.get('/api/subscriptions/catalog', (req,res)=>res.json({country:'IL',currency:'ILS',catalog:subscriptionCatalog,updatedAt:'2026-08-31'}));

app.get('/api/health',(req,res)=>res.json({ok:true,dbPath:dbPath,db:'sqlite',persistent:true}));
setInterval(()=>{try{db.pragma('wal_checkpoint(PASSIVE)')}catch{}},60000);

app.get(/^(?!\/api\/).*/, (req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(__dirname,'..','index.html'));});

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`MoneyTracker API listening on ${port}`));
