/* Cloud sync: per-word records, local-first, authenticated only. */
(function(){
'use strict';
const URL='https://rdhxitfpncwcacalgnef.supabase.co', KEY='sb_publishable_20Y__mGp-s92xltDn6BDGg_wV9UcyoQ';
const META='cet6_cloud_sync_meta_v1', SESSION='cet6_cloud_session_v1';
const storage=localStorage, nativeSet=Storage.prototype.setItem, nativeRemove=Storage.prototype.removeItem;
const read=(k,f)=>{try{return JSON.parse(storage.getItem(k))??f}catch{return f}};
const save=(k,v)=>nativeSet.call(storage,k,JSON.stringify(v));
const match=k=>/^(cet6_flash_733_audio_ipa_fixed_|cet6_middle_frequency_progress_v1_)/.test(k)||['handwritten_vocab_179_audio_ipa_v1','reading_vocab_28_v1','cet6_reading_intervention_17_v1','cet6_favorite_words_v1','cet6_favorite_review_v1','cet6_study_activity_v1','cet6_resume_position_v1','cet6_middle_frequency_resume_v1','handwriting_resume_position_v1','reading_resume_position_v1','cet6_reading_intervention_resume_v1','cet6_favorite_resume_v1'].includes(k);
const activity='cet6_study_activity_v1', favorite='cet6_favorite_words_v1';
const resume=k=>k.includes('resume');
function flatten(k,raw){
 const out=Object.create(null);if(raw===null)return out;
 let v;if(k==='cet6_favorite_resume_v1')v=raw;else try{v=JSON.parse(raw)}catch{v=raw}
 if(resume(k)){out['']=v;return out}
 if(k===activity){if(v?.startedAt)out['@started']=v.startedAt;for(const [day,entries] of Object.entries(v?.days||{}))for(const id of Object.keys(entries||{}))out[JSON.stringify([day,id])]=1;return out}
 if(v&&typeof v==='object'&&!Array.isArray(v))Object.assign(out,v);return out;
}
const rk=(k,i)=>JSON.stringify([k,i]);
let status='尚未登录',busy=false,timer,applying=false,firstDirty=0,retryDelay=60000; const CACHE='cet6_cloud_remote_cache_v2', MINUTE=60000; const pending=()=>Object.values(read(META,{})).filter(x=>x.dirty).length;
function show(s){status=s;const e=document.getElementById('cet6-cloud-status');if(e)e.textContent=s}
function note(k,before,after){
 if(!match(k)||applying)return;
 const a=flatten(k,before),b=flatten(k,after),m=read(META,{});
 for(const i of new Set([...Object.keys(a),...Object.keys(b)])){
 if(JSON.stringify(a[i])===JSON.stringify(b[i]))continue;
 m[rk(k,i)]={value:Object.hasOwn(b,i)?b[i]:null,deleted:!Object.hasOwn(b,i),at:new Date().toISOString(),dirty:true};
 }
 save(META,m);if(read(SESSION,null)){show('待同步 '+pending()+' 条');schedule();}
}
Storage.prototype.setItem=function(k,v){const old=this===storage&&match(k)?this.getItem(k):null;nativeSet.call(this,k,v);if(this===storage&&match(k))note(k,old,String(v))};
Storage.prototype.removeItem=function(k){const old=this===storage&&match(k)?this.getItem(k):null;nativeRemove.call(this,k);if(this===storage&&match(k))note(k,old,null)};
async function api(path,opts={},token){const r=await fetch(URL+path,{...opts,headers:{apikey:KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...opts.headers}});if(!r.ok)throw Error('HTTP '+r.status);const body=await r.text();return body?JSON.parse(body):null}
async function session(){let s=read(SESSION,null);if(!s)return null;if(s.expires_at*1000<Date.now()+60000){try{s=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:s.refresh_token})});save(SESSION,s)}catch(e){if(/HTTP (400|401|403)/.test(e.message)){nativeRemove.call(storage,SESSION);const form=document.querySelector('#cet6-cloud-panel form');if(form)form.hidden=false;}throw e}}return s}
function schedule(retry=false){if(!read(SESSION,null))return;clearTimeout(timer);const now=Date.now();if(!firstDirty)firstDirty=now;const delay=retry?retryDelay:Math.max(0,Math.min(MINUTE,5*MINUTE-(now-firstDirty)));timer=setTimeout(()=>sync(true),delay)}
function snapshot(){const m=read(META,{});for(let n=0;n<storage.length;n++){const k=storage.key(n);if(!match(k))continue;for(const [i,v] of Object.entries(flatten(k,storage.getItem(k)))){const id=rk(k,i);if(!Object.hasOwn(m,id))m[id]={value:v,deleted:false,at:null,dirty:true}}}save(META,m);return m}
function mergeInitial(k,a,b){if(k===favorite)return (a?.addedAt||0)>(b?.addedAt||0)?a:b;if(k===activity)return typeof a==='string'&&typeof b==='string'?(a<b?a:b):1;if(a==='unknown'||b==='unknown')return 'unknown';return b}
function apply(m){let changed=false;const groups=Object.create(null);for(const [id,r] of Object.entries(m)){let k,i;try{[k,i]=JSON.parse(id)}catch{continue}if(!match(k))continue;(groups[k]??=Object.create(null))[i]=r}
 applying=true;try{for(const [k,entries] of Object.entries(groups)){const current=flatten(k,storage.getItem(k));for(const [i,r] of Object.entries(entries)){if(r.deleted){if(Object.hasOwn(current,i))changed=true;delete current[i]}else{if(JSON.stringify(current[i])!==JSON.stringify(r.value))changed=true;current[i]=r.value}}
 if(resume(k)){if(Object.hasOwn(current,'')){const v=current[''];nativeSet.call(storage,k,k==='cet6_favorite_resume_v1'?String(v):JSON.stringify(v))}else nativeRemove.call(storage,k)}
 else if(k===activity){const v={version:1,startedAt:current['@started']||null,days:{}};for(const [i,x] of Object.entries(current)){if(i==='@started')continue;try{const [d,w]=JSON.parse(i);(v.days[d]??={})[w]=x}catch{}}nativeSet.call(storage,k,JSON.stringify(v))}
 else nativeSet.call(storage,k,JSON.stringify(current));
 }}finally{applying=false}return changed}
async function sync(force=false){if(busy||!read(SESSION,null)||navigator.onLine===false)return;const cached=read(CACHE,null);if(force!==true&&!pending()&&cached&&Date.now()-cached.pulledAt<MINUTE)return;busy=true;clearTimeout(timer);try{show('同步中…');const s=await session();if(!s)return;const uid=s.user.id;let m=snapshot();const old=read(CACHE,null);const pullStart=Date.now();const full=!old||old.uid!==uid||!old.fullAt||pullStart-old.fullAt>=24*60*MINUTE;const remote=full?Object.create(null):Object.assign(Object.create(null),old.records);const backupKey='cet6_cloud_original_backup_v1';if(!storage.getItem(backupKey)){const original={};for(let n=0;n<storage.length;n++){const k=storage.key(n);if(match(k))original[k]=storage.getItem(k)}save(backupKey,{createdAt:new Date().toISOString(),records:original})}const since=full?'':'&updated_at=gte.'+encodeURIComponent(new Date(Math.max(0,old.pulledAt-10*MINUTE)).toISOString());for(let offset=0;;offset+=500){const rows=await api('/rest/v1/study_records?select=record_key,record_data&order=updated_at.asc,record_key.asc&offset='+offset+'&limit=500'+since,{},s.access_token);for(const r of rows)remote[r.record_key]=r.record_data;if(rows.length<500)break}save(CACHE,{uid,records:remote,pulledAt:pullStart,fullAt:full?pullStart:old.fullAt});
 // Re-read local changes made while the request was in flight.
 m=snapshot();const upload=[]; const expected={};
 for(const id of new Set([...Object.keys(m),...Object.keys(remote)])){let l=m[id],r=remote[id];if(!l){m[id]={...r,dirty:false};continue}if(r&&!l.at&&!l.deleted){const [k,i]=JSON.parse(id);if(r.deleted||resume(k)){m[id]={...r,dirty:false};continue}const v=mergeInitial(k,l.value,r.value);if(JSON.stringify(v)===JSON.stringify(r.value)){m[id]={...r,dirty:false};continue}l={value:v,deleted:false,at:new Date().toISOString(),dirty:true};m[id]=l}
 if(r&&(!l.dirty||(r.at||'')>(l.at||''))){m[id]={...r,dirty:false};continue}
 if(l.dirty||(!r&&full)){l.at??=new Date().toISOString();expected[id]=r?.at??null;upload.push({user_id:uid,record_key:id,record_data:{value:l.value,deleted:l.deleted,at:l.at},updated_at:l.at})}}
 save(META,m);const changed=apply(m);if(changed){const hint=document.getElementById('cet6-cloud-hint');if(hint)hint.hidden=false;window.dispatchEvent(new Event('cet6:cloud-synced'));if(typeof window.render==='function'&&!location.pathname.includes('favorites')){try{window.render()}catch{}}}
 const inserted=upload.filter(row=>!remote[row.record_key]);const updated=upload.filter(row=>remote[row.record_key]);const ack=[];
 for(let i=0;i<inserted.length;i+=100){const batch=inserted.slice(i,i+100);const rows=await api('/rest/v1/study_records?on_conflict=user_id,record_key',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(batch)},s.access_token);ack.push(...(rows||[]))}
 for(const row of updated){const q=new URLSearchParams({user_id:'eq.'+uid,record_key:'eq.'+row.record_key,'record_data->>at':expected[row.record_key]?'eq.'+expected[row.record_key]:'is.null'});const rows=await api('/rest/v1/study_records?'+q,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({record_data:row.record_data,updated_at:row.updated_at})},s.access_token);ack.push(...(rows||[]))}
 const latest=read(META,{});for(const row of ack){remote[row.record_key]=row.record_data;const l=latest[row.record_key];if(l&&l.at===row.record_data.at&&JSON.stringify(l.value)===JSON.stringify(row.record_data.value))l.dirty=false}save(META,latest);save(CACHE,{uid,records:remote,pulledAt:pullStart,fullAt:full?pullStart:old.fullAt});
 if(upload.length!==ack.length||Object.values(latest).some(x=>x.dirty)){show('有待同步记录 · 自动重试');nativeRemove.call(storage,CACHE);schedule(true);retryDelay=Math.min(retryDelay*2,30*MINUTE);return}
 firstDirty=0;retryDelay=MINUTE;show('已同步 · '+new Date().toLocaleTimeString());window.dispatchEvent(new Event('cet6:cloud-synced'));
 }catch(e){show('同步未完成 · 本地记录已保留');console.warn('CET6 sync',e);if(pending()&&read(SESSION,null)){schedule(true);retryDelay=Math.min(retryDelay*2,30*MINUTE)}}finally{busy=false}}
 function ui(){const home=/^\/CET6-vocabulary\/(?:index\.html|index-pronunciation\.html)?$/i.test(location.pathname);if(!home){sync();return;}const box=document.createElement('details');box.id='cet6-cloud-panel';box.style.cssText='position:fixed;right:8px;bottom:8px;z-index:9999;background:#fffaf5;color:#594b68;border:1px solid #ddd1e5;border-radius:12px;padding:8px;font:13px system-ui;max-width:240px;box-shadow:0 2px 12px #0002';box.innerHTML='<summary id="cet6-cloud-status" style="cursor:pointer"></summary><form><input type="email" placeholder="邮箱" required autocomplete="username" style="width:100%;box-sizing:border-box;margin:5px 0"><input type="password" placeholder="密码" required autocomplete="current-password" style="width:100%;box-sizing:border-box;margin:5px 0"><button type="submit">登录并同步</button></form><button type="button" data-sync>立即同步</button> <button type="button" data-refresh>刷新页面</button><p id="cet6-cloud-hint" hidden>云端记录已更新，刷新可查看最新进度。</p><p><button type="button" data-backup>导出旧记录备份</button></p>';document.body.append(box);const form=box.querySelector('form');form.hidden=!!read(SESSION,null);show(form.hidden?'准备同步…':status);form.onsubmit=async e=>{e.preventDefault();try{const [email,password]=form.querySelectorAll('input');const s=await api('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:email.value,password:password.value})});save(SESSION,s);password.value='';form.hidden=true;await sync(true);}catch(e){show('登录失败，请检查邮箱密码或网络')}};box.querySelector('[data-sync]').onclick=()=>sync(true);box.querySelector('[data-refresh]').onclick=()=>location.reload();box.querySelector('[data-backup]').onclick=()=>{const original=storage.getItem('cet6_cloud_original_backup_v1');const records={};for(let n=0;n<storage.length;n++){const k=storage.key(n);if(match(k))records[k]=storage.getItem(k)}const blob=new Blob([JSON.stringify(original?JSON.parse(original):{records},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=window.URL.createObjectURL(blob);a.download='cet6-study-backup.json';a.click();setTimeout(()=>window.URL.revokeObjectURL(a.href),1000)};sync()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ui);else ui();
 window.addEventListener('online',()=>sync(true));window.addEventListener('pageshow',()=>sync());document.addEventListener('visibilitychange',()=>{if(document.hidden){if(pending())sync(true)}else sync()});window.addEventListener('pagehide',()=>{if(pending())sync(true)});
 window.CET6Cloud={sync};
})();