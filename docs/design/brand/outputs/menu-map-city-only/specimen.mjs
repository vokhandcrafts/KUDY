import {findMagnet,joinGroups} from './magnet.mjs';
import {amberMotion,amberPalette,lightThreads} from './amber-light.mjs';
const ns='http://www.w3.org/2000/svg';
const make=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
const stage=document.querySelector('#city-menu');
const say=text=>{document.querySelector('#message').textContent=text;};
window.addEventListener('unhandledrejection',()=>say('Не ўдалося загрузіць карту. Правер файлы пакета і абнаві старонку.'));
const dataResponse=await fetch('manifest.json');
if(!dataResponse.ok)throw new Error(`Could not load manifest: ${dataResponse.status}`);
const data=await dataResponse.json();
for(const [key,ms] of Object.entries(data.reveal))stage.style.setProperty(`--${key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())}`,`${ms}ms`);
await document.fonts.ready;
const measure=document.createElement('canvas').getContext('2d');measure.font='64px Golos';
const actors=new Map();
async function alphaPixels(item){
  const bitmap=new Image();bitmap.src=item.png;await bitmap.decode();
  const surface=document.createElement('canvas');surface.width=item.width;surface.height=item.height;
  const context=surface.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
  return context.getImageData(0,0,item.width,item.height).data;
}
for(const item of data.pieces){
  const actor={...item,alpha:await alphaPixels(item)};
  const node=make('g',{'class':'city-piece','data-piece':item.id,tabindex:0,role:'button'});
  const art=make('g',{'class':'art','pointer-events':'none'});
  art.append(make('image',{href:item.png,width:item.width,height:item.height}));
  art.append(make('image',{href:item.ui,x:-item.padding,y:-item.padding,width:item.width+item.padding*2,height:item.height+item.padding*2,'class':'ui-art'}));
  const mask=make('mask',{id:`city-veil-${item.id}`,maskUnits:'userSpaceOnUse',x:0,y:0,width:item.width,height:item.height});mask.append(make('image',{href:item.light,width:item.width,height:item.height}));stage.querySelector('defs').append(mask);
  art.append(make('rect',{x:0,y:0,width:item.width,height:item.height,fill:amberPalette.veil,mask:`url(#city-veil-${item.id})`,opacity:0,'class':'city-veil'}));
  art.append(make('path',{d:item.path,fill:'none',stroke:'#bd852c','stroke-width':8,opacity:0,'class':'outline'}));
  const caption=make('g',{'class':'caption'});node.append(art,caption);
  document.querySelector('#pieces').append(node);Object.assign(actor,{node,caption});actors.set(item.id,actor);
  node.addEventListener('keydown',event=>menu.key(event,actor));
  const option=document.createElement('option');option.value=item.id;option.textContent=item.label;
  document.querySelector('#edit-piece').append(option);
}
const scenery=[];
const threadNodes=lightThreads(0,0).map(thread=>{
  const group=make('g');
  for(const [width,opacity,color] of [[18,.1,amberPalette.glow],[7,.4,amberPalette.edge],[thread.width,.95,thread.core]])group.append(make('path',{d:thread.d,fill:'none',stroke:color,'stroke-width':width,'stroke-opacity':opacity,'stroke-linecap':'round','stroke-linejoin':'round','stroke-dasharray':'1700 1500'}));
  document.querySelector('#light-threads').append(group);return group;
});
for(const layer of data.layers){
  const wrap=make('g',{'class':'scene-part','data-layer':layer.id,role:'button',tabindex:-1,'aria-label':layer.id==='water'?'Вада і масты. Без пераходу.':'Астатняя карта. Без пераходу.'});
  wrap.append(make('image',{href:layer.png,x:layer.x,y:layer.y,width:layer.width,height:layer.height}));
  document.querySelector('#scene').append(wrap);
  const passive={...layer,node:wrap,alpha:await alphaPixels(layer),passive:true};scenery.push(passive);
  wrap.addEventListener('keydown',event=>{if(menu.revealed&&(event.key==='Enter'||event.key===' ')){event.preventDefault();menu.feedback(passive);}});
}

class CityMenu{
  constructor(){this.locale='be';this.edits={};this.groups=new Set();this.turn=0;this.active=null;this.keyboard=null;this.complete=false;}
  get reduced(){return document.querySelector('#reduce-motion').checked;}
  defer(fn,ms){const turn=this.turn;setTimeout(()=>{if(turn===this.turn)fn();},ms);}
  title(actor){return this.edits[`${this.locale}:${actor.id}`]?.trim()||data.labels[this.locale][actor.id];}
  reset(){
    this.cancel();this.turn++;this.complete=false;this.revealed=false;this.groups.clear();this.stopAnimations();stage.classList.remove('complete','settling');stage.dataset.phase='city';
    this.paintLight(-1);document.querySelector('#scene-radius').setAttribute('r',0);document.querySelector('#scene').setAttribute('aria-hidden','true');for(const part of scenery)part.node.setAttribute('tabindex',-1);
    document.querySelector('#sparks').replaceChildren();document.querySelector('#legend').classList.remove('visible');
    const places=[[170,190],[880,230],[1010,880],[130,850],[410,1400]];
    const flip=Math.random()<.5;
    [...actors.values()].forEach((actor,index)=>{
      let [x,y]=places[index];x+=Math.random()*22;y+=Math.random()*16;if(flip)x=1600-x-actor.width;
      actor.group={members:new Set([actor.id]),dx:x-125-actor.x,dy:y-320-actor.y,id:actor.id};this.groups.add(actor.group);
    });this.render();say('Націсні — адкрыць. Утрымлівай — рухаць.');
  }
  render(){
    for(const actor of actors.values()){
      const g=actor.group;actor.node.style.transform=`translate(${125+actor.x+g.dx}px,${320+actor.y+g.dy}px)`;
      actor.node.classList.toggle('grouped',g.members.size>1);actor.node.dataset.group=g.id;
      actor.node.setAttribute('aria-label',`${this.title(actor)}. Enter — адкрыць; стрэлкі — рухаць; S — злучыць.`);
    }
    const full=[...this.groups].find(g=>g.members.size===5);
    const sceneTransform=`translate(${125+(full?.dx??0)} ${320+(full?.dy??0)})`;
    document.querySelector('#scene').setAttribute('transform',sceneTransform);
    document.querySelector('#evolution').setAttribute('transform',`translate(${full?.dx??0} ${full?.dy??0})`);
  }
  names(){
    const legend=document.querySelector('#legend');legend.replaceChildren();
    for(const actor of actors.values()){
      const title=this.title(actor),cx=actor.width*.5,max=Math.max(350,Math.min(650,actor.width+80));
      const lines=[''];
      for(const word of title.trim().split(/(\s+)/u)){
        let last=lines.length-1;
        if(measure.measureText(lines[last]+word).width<=max){lines[last]+=word;continue;}
        if(measure.measureText(word).width<=max){lines.push(word.trimStart());continue;}
        for(const char of Array.from(word)){last=lines.length-1;if(lines[last]&&measure.measureText(lines[last]+char).width>max)lines.push(char);else lines[last]+=char;}
      }
      if(lines.length>2){lines.splice(2);let last=lines[1].trimEnd();while(last&&measure.measureText(last+'…').width>max)last=Array.from(last).slice(0,-1).join('');lines[1]=last+'…';}
      const first=-80-(lines.length-1)*76;
      const hit=make('rect',{x:cx-max/2,y:first-65,width:max,height:Math.max(200,lines.length*76+50),fill:'transparent'});
      actor.caption.replaceChildren(hit);
      const label=make('text',{'class':'label'});
      lines.forEach((line,i)=>{const span=make('tspan',{x:cx,y:first+i*76});span.textContent=line.trim();label.append(span);});
      let endpoint=[cx,0],distance=Infinity;
      for(let x=0;x<actor.width;x+=3)for(let y=0;y<actor.height;y+=3){if(actor.alpha[(y*actor.width+x)*4+3]>180){const d=(x-cx)**2+y*y;if(d<distance){distance=d;endpoint=[x,y];}break;}}
      actor.caption.append(make('path',{'class':'leader',d:`M${cx},-55 Q${cx+32},-15 ${endpoint[0]},${endpoint[1]}`}),make('circle',{'class':'dot',cx:endpoint[0],cy:endpoint[1],r:9}),label);
      const button=document.createElement('button');button.textContent=title;button.dataset.section=actor.id;button.onclick=()=>this.open(actor);legend.append(button);
    }
    const selected=actors.get(document.querySelector('#edit-piece').value);document.querySelector('#edit-label').value=this.edits[`${this.locale}:${selected.id}`]??this.title(selected);
    this.render();
  }
  open(actor){
    document.querySelector('#section-name').textContent=this.title(actor);
    document.querySelector('#section').showModal();
  }
  feedback(part,event){
    let x=800,y=902;
    if(event){const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(stage.getScreenCTM().inverse());x=local.x;y=local.y;}
    const ripple=make('circle',{'class':'map-ripple',cx:x,cy:y,r:36,'pointer-events':'none'});document.querySelector('#sparks').append(ripple);setTimeout(()=>ripple.remove(),500);
    stage.dataset.lastPassive=part.id;say('Частка карты. Без пераходу.');
  }
  at(event){
    const label=event.target.closest('.caption');if(label&&!this.complete)return actors.get(label.parentNode.dataset.piece);
    for(const actor of [...actors.values()].reverse()){
      const matrix=actor.node.getScreenCTM();if(!matrix)continue;
      const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      const x=Math.floor(local.x),y=Math.floor(local.y);
      if(x>=0&&y>=0&&x<actor.width&&y<actor.height&&actor.alpha[(y*actor.width+x)*4+3]>32)return actor;
    }
    const visibleRadius=Number(document.querySelector('#scene-radius').getAttribute('r'));
    if(visibleRadius>0){
      const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(document.querySelector('#scene').getScreenCTM().inverse());
      if(Math.hypot(local.x-675,local.y-582)>visibleRadius)return;
      for(const part of scenery){const x=Math.floor(local.x-part.x),y=Math.floor(local.y-part.y);if(x>=0&&y>=0&&x<part.width&&y<part.height&&part.alpha[(y*part.width+x)*4+3]>32)return part;}
    }
  }
  nearest(group){
    return findMagnet(group,actors,data.joints,data.gesture.snapDistanceDp*1600/stage.clientWidth);
  }
  glow(joint,group){
    if(this.reduced)return;
    const [px,py]=joint.port,x=125+group.dx+px,y=320+group.dy+py;
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,ray=make('line',{'class':'spark',x1:x+Math.cos(angle)*14,y1:y+Math.sin(angle)*14,x2:x+Math.cos(angle)*48,y2:y+Math.sin(angle)*48});
      document.querySelector('#sparks').append(ray);setTimeout(()=>ray.remove(),420);
    }
  }
  dock(group){
    const target=this.nearest(group);if(!target){say('Падсунь да патрэбнага суседа.');return false;}
    const {other,joint}=target,moving=[...group.members].map(id=>actors.get(id)),before=moving.map(p=>p.node.style.transform);
    joinGroups(group,other,actors,this.groups);
    this.render();if(!this.reduced&&group.members.size<5)moving.forEach((p,i)=>p.node.animate([{transform:before[i]},{transform:p.node.style.transform}],{duration:220,easing:'cubic-bezier(.2,1.25,.4,1)'}));
    this.glow(joint,group);say(`Злучана ${group.members.size} з 5. Рухаюцца разам.`);
    if(group.members.size===5)this.finish(group);
    return true;
  }
  shift(group,dx,dy){
    const members=[...group.members].map(id=>actors.get(id));
    const minX=this.complete?0:Math.min(...members.map(p=>p.x)),maxX=this.complete?1351:Math.max(...members.map(p=>p.x+p.width));
    const minY=this.complete?0:Math.min(...members.map(p=>p.y)),maxY=this.complete?1164:Math.max(...members.map(p=>p.y+p.height));
    group.dx=Math.max(-minX-55,Math.min(1390-maxX,group.dx+dx));
    group.dy=Math.max(-minY-130,Math.min(1370-maxY,group.dy+dy));this.render();
  }
  rest(){for(const p of actors.values()){p.node.dataset.touch='idle';p.node.querySelector('.outline').setAttribute('opacity',0);}}
  moveHint(group){this.rest();for(const id of group.members)actors.get(id).node.dataset.touch='dragging';const target=this.nearest(group);if(target){for(const id of target.other.members)actors.get(id).node.querySelector('.outline').setAttribute('opacity',1);say('Правільны сусед. Адпусці, каб злучыць.');}}
  cancel(){
    const movement=this.active??this.keyboard;if(!movement)return;clearTimeout(movement.hold);
    movement.group.dx=movement.original[0];movement.group.dy=movement.original[1];this.active=null;this.keyboard=null;this.rest();this.render();
  }
  key(event,actor){
    if(this.complete&&stage.dataset.phase!=='complete'&&event.key.startsWith('Arrow'))return;
    const distance=8*1600/stage.clientWidth,arrows={ArrowLeft:[-distance,0],ArrowRight:[distance,0],ArrowUp:[0,-distance],ArrowDown:[0,distance]};
    if(arrows[event.key]){event.preventDefault();if(this.keyboard?.group!==actor.group)this.keyboard={group:actor.group,original:[actor.group.dx,actor.group.dy]};this.shift(actor.group,...arrows[event.key]);this.moveHint(actor.group);}
    else if(event.key.toLowerCase()==='s'){event.preventDefault();this.keyboard=null;this.rest();if(!this.complete)this.dock(actor.group);}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();this.keyboard=null;this.open(actor);}
  }
  finish(group){
    this.complete=true;stage.classList.add('complete');
    if(!this.reduced)stage.classList.add('settling');group.dx=0;group.dy=0;this.render();
    const start=()=>{
      stage.classList.remove('settling');
      if(this.reduced){this.showComplete();return;}
      say('Пяць частак злучаныя. Пад імі нарастае святло…');for(const joint of data.joints)this.glow(joint,group);this.reveal();
    };
    this.defer(start,this.reduced?0:400);
  }
  reveal(){
    const begin=performance.now(),turn=this.turn;
    const frame=now=>{if(turn!==this.turn)return;const effect=this.paintLight(now-begin);stage.dataset.phase=effect.phase==='settling'?'settled':effect.phase;document.querySelector('#scene-radius').setAttribute('r',effect.radius);if(effect.phase!=='complete')requestAnimationFrame(frame);else this.showComplete();};
    requestAnimationFrame(frame);
  }
  paintLight(elapsed){
    const effect=amberMotion(elapsed,data.reveal);
    document.querySelector('.radiance').style.opacity=effect.light;document.querySelector('.radiance').style.transform=`scale(${.4+effect.light*.6})`;
    document.querySelector('.energy-ring').style.opacity=effect.light*.25;
    for(const actor of actors.values())actor.node.querySelector('.city-veil').setAttribute('opacity',effect.veil);
    lightThreads(effect.progress,effect.light).forEach((thread,i)=>{const group=threadNodes[i];group.setAttribute('opacity',thread.opacity);group.setAttribute('transform',`translate(${thread.x} ${thread.y})`);for(const path of group.children)path.setAttribute('stroke-dashoffset',thread.offset);});
    return effect;
  }
  showComplete(){
    this.paintLight(Object.values(data.reveal).reduce((sum,ms)=>sum+ms,0));
    this.revealed=true;document.querySelector('#scene-radius').setAttribute('r',1000);stage.classList.remove('settling');stage.dataset.phase='complete';
    document.querySelector('#scene').setAttribute('aria-hidden','false');
    for(const part of scenery)part.node.setAttribute('tabindex',0);
    document.querySelector('#legend').classList.add('visible');say('Карта адкрыта. Пяць раздзелаў і ўсе новыя часткі клікабельныя.');
  }
  stopAnimations(){for(const actor of actors.values())actor.node.getAnimations().forEach(animation=>animation.cancel());}
  auto(){
    this.cancel();this.turn++;this.stopAnimations();this.rest();this.paintLight(-1);this.revealed=false;stage.dataset.phase='city';document.querySelector('#scene').setAttribute('aria-hidden','true');document.querySelector('#sparks').replaceChildren();document.querySelector('#scene-radius').setAttribute('r',0);for(const part of scenery)part.node.setAttribute('tabindex',-1);const group={members:new Set(actors.keys()),dx:0,dy:0,id:'assembled'};this.groups=new Set([group]);for(const actor of actors.values())actor.group=group;this.finish(group);
  }
}

const menu=new CityMenu();
document.querySelector('#reduce-motion').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelector('#reduce-motion').onchange=()=>{document.body.classList.toggle('reduced',menu.reduced);if(menu.reduced){document.querySelector('#sparks').replaceChildren();menu.stopAnimations();if(menu.complete){menu.turn++;menu.showComplete();}}};
document.querySelector('#build').onclick=()=>menu.auto();document.querySelector('#scatter').onclick=()=>menu.reset();
document.querySelector('#back').onclick=()=>document.querySelector('#section').close();
document.querySelector('#locale').onchange=event=>{menu.locale=event.target.value;menu.names();};
document.querySelector('#edit-piece').onchange=()=>menu.names();
document.querySelector('#edit-label').oninput=event=>{menu.edits[`${menu.locale}:${document.querySelector('#edit-piece').value}`]=event.target.value;menu.names();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(menu.active||menu.keyboard)){menu.cancel();say('Рух скасаваны.');}});
stage.onpointerdown=event=>{
  if(menu.active||event.button!==0||!event.isPrimary)return;
  const actor=menu.at(event);if(!actor)return;const group=actor.group;
  if(actor.passive){menu.feedback(actor,event);return;}
  if(menu.complete&&stage.dataset.phase!=='complete'){menu.open(actor);return;}
  menu.keyboard=null;
  stage.setPointerCapture(event.pointerId);actor.node.dataset.touch='pressed';
  const active={actor,group,id:event.pointerId,original:[group.dx,group.dy],x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,held:false,cancelled:false};
  active.hold=setTimeout(()=>{if(menu.active===active&&!active.cancelled){active.held=true;for(const id of group.members)actors.get(id).node.dataset.touch='held';say('Перамяшчай. Escape — вярнуць назад.');}},data.gesture.holdMs);menu.active=active;
};
stage.onpointermove=event=>{
  const active=menu.active;if(!active||event.pointerId!==active.id)return;
  if(!active.held){if(Math.hypot(event.clientX-active.x,event.clientY-active.y)>data.gesture.tapSlopDp){active.cancelled=true;clearTimeout(active.hold);menu.rest();}return;}
  if(event.clientX===active.lastX&&event.clientY===active.lastY)return;
  const scale=1600/stage.clientWidth;menu.shift(active.group,(event.clientX-active.lastX)*scale,(event.clientY-active.lastY)*scale);active.lastX=event.clientX;active.lastY=event.clientY;menu.moveHint(active.group);
  if(!menu.complete&&menu.nearest(active.group)){menu.active=null;clearTimeout(active.hold);menu.rest();menu.dock(active.group);if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);}
};
stage.onpointerup=event=>{
  const active=menu.active;if(!active||event.pointerId!==active.id)return;clearTimeout(active.hold);menu.active=null;menu.rest();
  if(active.held)say(menu.complete?'Карта перамешчаная. Раздзелы даступныя.':'Націсні — адкрыць. Утрымлівай і перацягвай — злучыць.');
  else if(!active.cancelled)menu.open(active.actor);
};
stage.onpointercancel=()=>menu.cancel();stage.onlostpointercapture=()=>menu.cancel();
menu.reset();menu.names();
