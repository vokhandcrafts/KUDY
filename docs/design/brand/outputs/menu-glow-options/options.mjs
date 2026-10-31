import {amberPalette,lightThreads} from '../menu-map-city-only/amber-light.mjs';
export const variants=[
  {id:'amber',title:'Бурштынавае святло',...amberPalette,accent:'#ffd76c',motif:'rings',description:'Выбраны варыянт. Мядовы арэол і тонкія павольныя ніткі з мяккай светлай сярэдзінай.',selected:true},
  {id:'sea',title:'Марская біруза',core:'#eafff5',glow:'#80e4d1',edge:'#52c6d0',accent:'#ffd277',veil:'#dcfff0',motif:'waves',description:'Біруза з мятным святлом і тонкай залатой хваляй. Горад нібы праяўляецца з вады.'},
  {id:'pearl',title:'Перламутр',core:'#fff7ef',glow:'#ddcbff',edge:'#a9e2eb',accent:'#f2b9d3',veil:'#f5eaff',motif:'orbits',description:'Малочны цэнтр, бэзавы і ружовыя водбліскі. Два лёгкія перламутравыя абручы.'},
  {id:'aurora',title:'Паўночнае ззянне',core:'#efffd4',glow:'#86e7ba',edge:'#8bcfff',accent:'#c5ffb2',veil:'#dfffce',motif:'curtains',description:'Зялёныя і блакітныя стужкі паднімаюцца знізу. Найбольш казачнае ператварэнне.'},
  {id:'sun',title:'Сонечны россып',core:'#fff0d5',glow:'#ffbd9c',edge:'#e9a5cb',accent:'#ffc858',veil:'#ffe5cf',motif:'stars',description:'Персікавае святло, каралавыя іскры і залатыя зоркі. Цёплае, жывое маленькае свята.'},
];

export function motion(value){
  const t=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
  const charge=Math.max(0,Math.min(1,(t-.08)/.32));
  const reveal=Math.max(0,Math.min(1,(t-.52)/.33));
  const fade=Math.max(0,Math.min(1,(t-.52)/.48));
  return {t,light:t<.4?charge:1-fade,veil:t<.4?charge*.94:t<.52?.94:.94*(1-reveal),radius:1000*(1-(1-reveal)**3),phase:t<.08?'Пяць частак разам':t<.4?'Нарастанне святла':t<.52?'Светлы сілуэт':t<.85?'Праяўленне карты':t<1?'Святло сціхае':'Поўная карта'};
}

const asset=file=>'../menu-map-city-only/'+file;
const picture=(p,href=p.png)=>`<image href="${asset(href)}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}"/>`;
function accents(v,s){
  const opacity=Math.max(0,s.light)*.8;
  if(v.motif==='waves')return `<g fill="none" stroke-width="9" opacity="${opacity}"><path d="M80 750 Q330 1040 680 900 T1280 680" stroke="${v.accent}"/><path d="M20 800 Q360 1110 700 955 T1340 700" stroke="${v.edge}"/></g>`;
  if(v.motif==='orbits')return `<g fill="none" stroke-width="8" opacity="${opacity}" transform="translate(675 582)"><ellipse rx="720" ry="380" transform="rotate(-20)" stroke="${v.accent}"/><ellipse rx="690" ry="420" transform="rotate(24)" stroke="${v.edge}"/></g>`;
  if(v.motif==='curtains')return `<g fill="none" stroke-width="25" stroke-linecap="round" opacity="${opacity*.65}" transform="translate(0 ${150*(1-Math.min(1,s.t/.4))})"><path d="M220 1060 C-40 700 390 520 120 90" stroke="${v.glow}"/><path d="M1140 1090 C1460 700 970 440 1240 10" stroke="${v.edge}"/><path d="M320 1150 C80 800 480 630 310 160" stroke="${v.accent}"/></g>`;
  if(v.motif==='stars')return `<g opacity="${opacity}">${Array.from({length:10},(_,i)=>{const angle=i*Math.PI/5,x=675+Math.cos(angle)*640,y=582+Math.sin(angle)*550,r=18+(i%3)*7;return `<path d="M${x-r},${y} Q${x},${y} ${x},${y-r} Q${x},${y} ${x+r},${y} Q${x},${y} ${x},${y+r} Q${x},${y} ${x-r},${y}" fill="${i%2?v.accent:v.edge}"/>`;}).join('')}</g>`;
  const threads=lightThreads(s.t,s.light).map(thread=>`<g transform="translate(${thread.x} ${thread.y})" opacity="${thread.opacity}">${[[18,.1,v.glow],[7,.4,v.edge],[thread.width,.95,thread.core]].map(([width,alpha,color])=>`<path d="${thread.d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${alpha}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1700 1500" stroke-dashoffset="${thread.offset}"/>`).join('')}</g>`).join('');
  return `<g pointer-events="none">${threads}<g fill="none" stroke="${v.accent}" opacity="${opacity*.35}"><ellipse cx="675" cy="582" rx="690" ry="560" stroke-width="5"/><ellipse cx="675" cy="582" rx="740" ry="610" stroke-width="2"/></g></g>`;
}

export function scene(v,data,value){
  const s=motion(value),id=v.id;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -120 1551 1404" role="img" aria-label="${v.title}" data-variant="${id}" data-phase="${s.phase}">
  <defs><radialGradient id="glow-${id}"><stop offset="0" stop-color="${v.core}"/><stop offset=".4" stop-color="${v.glow}" stop-opacity=".95"/><stop offset="1" stop-color="${v.edge}" stop-opacity="0"/></radialGradient><mask id="veil-${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1351" height="1164">${data.pieces.map(p=>picture(p,p.light)).join('')}</mask><clipPath id="reveal-${id}"><circle cx="675" cy="582" r="${s.radius}"/></clipPath></defs>
  <ellipse cx="675" cy="582" rx="${400+s.light*410}" ry="${360+s.light*380}" fill="url(#glow-${id})" opacity="${s.light}"/>
  ${accents(v,s)}<g data-art="city">${data.pieces.map(p=>picture(p)).join('')}</g>
  <rect x="0" y="0" width="1351" height="1164" fill="${v.veil}" opacity="${s.veil}" mask="url(#veil-${id})"/>
  <g clip-path="url(#reveal-${id})">${data.layers.map(p=>picture(p)).join('')}</g></svg>`;
}

if(typeof document!=='undefined'){
  const play=document.querySelector('#play'),slider=document.querySelector('#progress'),phase=document.querySelector('#phase'),root=document.querySelector('#options');
  let frame=null,assets;
  const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;play.textContent='Прайграць усе пяць';};
  function draw(value){
    const s=motion(value);if(phase.textContent!==s.phase)phase.textContent=s.phase;slider.value=Math.round(s.t*100);
    for(const v of variants)document.querySelector(`#visual-${v.id}`).innerHTML=scene(v,assets,s.t);
  }
  try{
    const response=await fetch('../menu-map-city-only/manifest.json');if(!response.ok)throw new Error(`Assets: ${response.status}`);assets=await response.json();
    if(assets.pieces.length!==5||assets.layers.length!==2)throw new Error('Expected five menu pieces and two scene layers');
    for(const p of assets.pieces)if(!/^pieces\/[a-z0-9-]+\.png$/.test(p.png)||!/^pieces\/[a-z0-9-]+--light\.png$/.test(p.light))throw new Error('Invalid local image path');
    for(const p of assets.layers)if(!/^layers\/[a-z0-9-]+\.png$/.test(p.png))throw new Error('Invalid local scene path');
    await Promise.all([...assets.pieces.flatMap(p=>[p.png,p.light]),...assets.layers.map(p=>p.png)].map(async file=>{const image=new Image();image.src=asset(file);await image.decode();}));
    root.innerHTML=variants.map((v,i)=>`<article class="option"><h2><span class="number">${i+1}</span>${v.title}</h2><div id="visual-${v.id}"></div><div class="palette">${[v.core,v.glow,v.edge,v.accent].map(c=>`<span class="swatch" style="background:${c}"></span>`).join('')}${v.selected?'<span class="pick">Выбрана</span>':''}</div><p>${v.description}</p></article>`).join('');
    play.disabled=false;slider.disabled=false;draw(.48);
    slider.oninput=()=>{stop();draw(Number(slider.value)/100);};
    play.onclick=()=>{
      if(frame!==null){stop();return;}
      if(matchMedia('(prefers-reduced-motion: reduce)').matches){draw(1);return;}
      const start=performance.now();play.textContent='Спыніць';draw(0);
      const tick=now=>{const t=Math.min(1,(now-start)/2700);draw(t);if(t<1)frame=requestAnimationFrame(tick);else stop();};frame=requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    window.addEventListener('pagehide',stop);
  }catch(error){stop();play.disabled=true;slider.disabled=true;phase.textContent='Не ўдалося загрузіць асеты. Абнаві старонку.';console.error(error);}
}
