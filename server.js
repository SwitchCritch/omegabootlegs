import express from 'express';
import pg from 'pg';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import {parse as parseCsv} from 'csv-parse/sync';
import {stringify as stringifyCsv} from 'csv-stringify/sync';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(express.json({limit:'2mb'}));
app.use(cookieParser());
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');next()});
const DATA=process.env.DATA_DIR||path.join(__dirname,'.data');
const IMAGES=path.join(DATA,'images');
fs.mkdirSync(IMAGES,{recursive:true});
const DBFILE=path.join(DATA,'recordings.json');
const adminPassword=process.env.ADMIN_PASSWORD||'';
const secret=process.env.SESSION_SECRET||'';
const usePg=!!process.env.DATABASE_URL;
const pool=usePg?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:false}:undefined}):null;
if(!adminPassword || !secret) console.warn('WARNING: Set ADMIN_PASSWORD and SESSION_SECRET before logging in.');
if(!usePg) console.warn('Using local JSON storage. Mount a persistent volume at DATA_DIR on Railway or connect PostgreSQL.');
if(pool) await pool.query('CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())');
if(!usePg && !fs.existsSync(DBFILE)) fs.writeFileSync(DBFILE,'[]');
let records=usePg?null:JSON.parse(fs.readFileSync(DBFILE,'utf8'));
async function all(){return usePg?(await pool.query('SELECT data FROM recordings ORDER BY updated_at DESC')).rows.map(x=>x.data):[...records].reverse()}
async function one(id){return usePg?(await pool.query('SELECT data FROM recordings WHERE id=$1',[id])).rows[0]?.data:records.find(x=>x.id===id)}
async function save(r){if(usePg)await pool.query('INSERT INTO recordings(id,data,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(id) DO UPDATE SET data=$2,updated_at=NOW()',[r.id,JSON.stringify(r)]);else{records=records.filter(x=>x.id!==r.id);records.push(r);fs.writeFileSync(DBFILE,JSON.stringify(records,null,2))}}
async function remove(id){if(usePg)await pool.query('DELETE FROM recordings WHERE id=$1',[id]);else{records=records.filter(x=>x.id!==id);fs.writeFileSync(DBFILE,JSON.stringify(records,null,2))}}
function sign(payload){return crypto.createHmac('sha256',secret).update(payload).digest('hex')}
function logged(req){const c=req.cookies?.archive_auth;if(!c||!secret)return false;const [until,mac]=c.split('.');if(!until||!mac||!/^\d+$/.test(until)||Number(until)<Date.now())return false;const expected=sign(until);return mac.length===expected.length && crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected))}
function admin(req,res,next){if(!logged(req))return res.status(401).json({error:'Admin login required'});next()}
const limiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false});
app.post('/api/login',limiter,(req,res)=>{if(!adminPassword||!secret)return res.status(503).json({error:'Configure ADMIN_PASSWORD and SESSION_SECRET first'});const attempt=String(req.body?.password||'');const a=Buffer.from(attempt),b=Buffer.from(adminPassword);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Incorrect password'});const until=String(Date.now()+7*864e5);res.cookie('archive_auth',`${until}.${sign(until)}`,{httpOnly:true,secure:req.secure,sameSite:'strict',maxAge:7*864e5,path:'/'});res.json({ok:true})});
app.post('/api/logout',(req,res)=>{res.clearCookie('archive_auth',{path:'/'});res.json({ok:true})});
app.get('/api/me',(req,res)=>res.json({admin:logged(req),setlistReady:!!process.env.SETLIST_FM_API_KEY}));
app.get('/api/recordings',async(req,res,next)=>{try{res.json(await all())}catch(e){next(e)}});
function clean(o,id){const text=(k,n=500)=>String(o[k]??'').slice(0,n).trim();const allowed=['audio','video'];const setlist=Array.isArray(o.setlist)?o.setlist.map(s=>({name:String(s.name||'').slice(0,250),note:String(s.note||'').slice(0,500),encore:Number(s.encore)||0})).filter(s=>s.name).slice(0,100):[];
 const images=Array.isArray(o.images)?o.images.filter(x=>typeof x==='string'&&/^\/images\/[a-f0-9-]+\.(jpg|png|webp)$/.test(x)).slice(0,60):[];
 return {id,kind:allowed.includes(o.kind)?o.kind:'audio',artist:text('artist',150)||'Marilyn Manson',title:text('title',250),date:text('date',10),venue:text('venue',200),city:text('city',160),state:text('state',100),country:text('country',100),tour:text('tour',200),format:text('format',100),duration:text('duration',30),quality:text('quality',100),source:text('source',160),resolution:text('resolution',100),aspectRatio:text('aspectRatio',60),fileSize:text('fileSize',60),notes:text('notes',10000),setlist,setlistUrl:/^https:\/\/(www\.)?setlist\.fm\//.test(text('setlistUrl',700))?text('setlistUrl',700):'',images,createdAt:text('createdAt',40)||new Date().toISOString(),updatedAt:new Date().toISOString()}}
app.post('/api/recordings',admin,async(req,res,next)=>{try{const r=clean(req.body,crypto.randomUUID());await save(r);res.json(r)}catch(e){next(e)}});
app.put('/api/recordings/:id',admin,async(req,res,next)=>{try{const prior=await one(req.params.id);if(!prior)return res.status(404).json({error:'Not found'});const r=clean({...req.body,createdAt:prior.createdAt},prior.id);await save(r);res.json(r)}catch(e){next(e)}});
app.delete('/api/recordings/:id',admin,async(req,res,next)=>{try{const prior=await one(req.params.id);if(!prior)return res.status(404).json({error:'Not found'});await remove(prior.id);res.json({ok:true})}catch(e){next(e)}});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:12}});
const signatures={jpg:b=>b.length>3&&b[0]===255&&b[1]===216&&b[2]===255,png:b=>b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),webp:b=>b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'};
const imageType=b=>Object.keys(signatures).find(x=>signatures[x](b));
app.post('/api/images',admin,upload.array('images',12),(req,res)=>{try{const paths=[];for(const f of req.files||[]){const ext=imageType(f.buffer);if(!ext)throw new Error('Only genuine JPG, PNG and WebP images are supported');const name=`${crypto.randomUUID()}.${ext}`;fs.writeFileSync(path.join(IMAGES,name),f.buffer);paths.push(`/images/${name}`)}res.json({images:paths})}catch(e){res.status(400).json({error:e.message})}});
app.use('/images',express.static(IMAGES,{fallthrough:false,maxAge:'1d'}));
let lastLookup=0;
app.get('/api/setlist-search',admin,async(req,res)=>{try{const key=process.env.SETLIST_FM_API_KEY;if(!key)return res.status(503).json({error:'Add SETLIST_FM_API_KEY in Railway variables to enable lookup'});if(Date.now()-lastLookup<1000)return res.status(429).json({error:'Please leave a second between searches'});lastLookup=Date.now();const url=new URL('https://api.setlist.fm/rest/1.0/search/setlists');for(const k of ['artistName','venueName','cityName','year','p']){if(req.query[k])url.searchParams.set(k,String(req.query[k]).slice(0,120))}if(!url.searchParams.get('artistName'))url.searchParams.set('artistName','Marilyn Manson');const response=await fetch(url,{headers:{'x-api-key':key,'Accept':'application/json','Accept-Language':'en'},signal:AbortSignal.timeout(12000)});if(!response.ok)return res.status(502).json({error:`setlist.fm returned HTTP ${response.status}. Check your API key and usage limits.`});const raw=await response.json();res.json({total:raw.total||0,page:raw.page||1,items:(raw.setlist||[]).map(s=>({id:s.id,date:s.eventDate,artist:s.artist?.name,venue:s.venue?.name,city:s.venue?.city?.name,state:s.venue?.city?.state,country:s.venue?.city?.country?.name,tour:s.tour?.name,setlistUrl:s.url,setlist:(s.sets?.set||[]).flatMap(t=>(t.song||[]).map(song=>({name:song.name||'',note:song.info||'',encore:t.encore||0}))) }))})}catch(e){res.status(502).json({error:e.message})}});
const cols=['kind','artist','title','date','venue','city','state','country','tour','format','duration','quality','source','resolution','aspectRatio','fileSize','notes','setlistUrl','setlist'];
app.get('/api/export/:type',admin,async(req,res,next)=>{try{const rs=await all();if(req.params.type==='json'){res.setHeader('Content-Disposition','attachment; filename="manson-archive.json"');return res.json({version:1,exportedAt:new Date().toISOString(),recordings:rs})}if(req.params.type==='csv'){res.type('text/csv').setHeader('Content-Disposition','attachment; filename="manson-archive.csv"');return res.send(stringifyCsv(rs.map(r=>Object.fromEntries(cols.map(k=>[k,k==='setlist'?JSON.stringify(r[k]||[]):r[k]||'']))),{header:true,columns:cols}))}if(req.params.type==='zip'){res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition','attachment; filename="manson-archive-backup.zip"');const archive=archiver('zip',{zlib:{level:6}});archive.on('error',e=>res.destroy(e));archive.pipe(res);archive.append(JSON.stringify({version:1,recordings:rs},null,2),{name:'recordings.json'});for(const name of new Set(rs.flatMap(r=>r.images||[]).map(x=>path.basename(x)))){const f=path.join(IMAGES,name);if(fs.existsSync(f))archive.file(f,{name:`images/${name}`})}archive.finalize();return}res.status(404).json({error:'Unknown export type'})}catch(e){next(e)}});
app.post('/api/import',admin,multer({storage:multer.memoryStorage(),limits:{fileSize:40*1024*1024}}).single('file'),async(req,res)=>{try{if(!req.file)throw new Error('Choose a CSV, JSON or ZIP file');const ext=path.extname(req.file.originalname).toLowerCase();let rows=[];
if(ext==='.json'){const obj=JSON.parse(req.file.buffer.toString());rows=Array.isArray(obj)?obj:obj.recordings}
else if(ext==='.csv'){rows=parseCsv(req.file.buffer.toString(),{columns:true,skip_empty_lines:true}).map(r=>({...r,setlist:r.setlist?JSON.parse(r.setlist):[]}))}
else if(ext==='.zip'){const z=new AdmZip(req.file.buffer);const entry=z.getEntry('recordings.json');if(!entry)throw new Error('Backup ZIP has no recordings.json');const obj=JSON.parse(entry.getData().toString());rows=obj.recordings;for(const item of z.getEntries()){if(!/^images\/[a-f0-9-]+\.(jpg|png|webp)$/.test(item.entryName))continue;const buff=item.getData();if(buff.length>8*1024*1024||!imageType(buff))continue;fs.writeFileSync(path.join(IMAGES,path.basename(item.entryName)),buff)}}
else throw new Error('Supported imports: JSON, CSV and ZIP');if(!Array.isArray(rows)||rows.length>10000)throw new Error('Invalid or oversized collection');let added=0,updated=0;for(const row of rows){const id=(typeof row.id==='string'&&/^[a-f0-9-]{36}$/.test(row.id))?row.id:crypto.randomUUID();const exists=await one(id);const r=clean(row,id);await save(r);exists?updated++:added++}res.json({ok:true,added,updated})}catch(e){res.status(400).json({error:e.message})}});
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.code==='LIMIT_FILE_SIZE'?'Upload too large':err.message||'Server error'})});
const port=process.env.PORT||3000;app.listen(port,'0.0.0.0',()=>console.log('Archive running on port',port));
