import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const db=new Database(path.join(__dirname,'moneytracker.db'));
const JWT_SECRET=process.env.JWT_SECRET||'CHANGE_ME_IN_PRODUCTION';
app.use(cors());app.use(express.json({limit:'2mb'}));
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS user_data(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
function auth(req,res,next){try{const t=(req.headers.authorization||'').replace(/^Bearer /,'');req.user=jwt.verify(t,JWT_SECRET);next()}catch{res.status(401).json({error:'unauthorized'})}}
app.post('/api/register',(req,res)=>{const {email,name,password}=req.body||{};if(!email||!name||!password)return res.status(400).json({error:'missing fields'});try{const hash=bcrypt.hashSync(password,12);const info=db.prepare('INSERT INTO users(email,name,password_hash,created_at) VALUES(?,?,?,?)').run(email.toLowerCase(),name,hash,new Date().toISOString());const id=Number(info.lastInsertRowid);db.prepare('INSERT INTO user_data(user_id,state_json,updated_at) VALUES(?,?,?)').run(id,'{}',new Date().toISOString());res.json({ok:true,id})}catch(e){res.status(409).json({error:'email already exists'})}});
app.post('/api/login',(req,res)=>{const {email,password}=req.body||{};const u=db.prepare('SELECT id,name,password_hash FROM users WHERE email=?').get(String(email||'').toLowerCase());if(!u||!bcrypt.compareSync(password||'',u.password_hash))return res.status(401).json({error:'invalid credentials'});res.json({token:jwt.sign({id:u.id,name:u.name},JWT_SECRET,{expiresIn:'30d'}),user:{id:u.id,name:u.name}})});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/state',auth,(req,res)=>{const row=db.prepare('SELECT state_json,updated_at FROM user_data WHERE user_id=?').get(req.user.id);res.json({state:JSON.parse(row?.state_json||'{}'),updatedAt:row?.updated_at||null})});
app.put('/api/state',auth,(req,res)=>{const state=req.body?.state;if(!state||typeof state!=='object')return res.status(400).json({error:'invalid state'});const now=new Date().toISOString();db.prepare('INSERT INTO user_data(user_id,state_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(req.user.id,JSON.stringify(state),now);res.json({ok:true,updatedAt:now})});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||3000,()=>console.log('MoneyTracker API listening on '+(process.env.PORT||3000)));
