export const amberPalette={core:'#fff4d9',glow:'#ffd17b',edge:'#e8a447',veil:'#fff0c8'};
const clamp=value=>Math.max(0,Math.min(1,value));
export function amberMotion(elapsed,{chargeMs,crestMs,revealMs,settleMs}){
  const total=chargeMs+crestMs+revealMs+settleMs,progress=clamp(elapsed/total);
  const reveal=clamp((elapsed-chargeMs-crestMs)/revealMs);
  const light=elapsed<0?0:elapsed<chargeMs?clamp(elapsed/chargeMs):elapsed<chargeMs+crestMs?1:1-clamp((elapsed-chargeMs-crestMs)/(revealMs+settleMs));
  const veil=elapsed<0?0:elapsed<chargeMs?.94*clamp(elapsed/chargeMs):.94*(1-reveal);
  return {progress,light,veil,radius:1000*(1-(1-reveal)**3),phase:elapsed<chargeMs?'charging':elapsed<chargeMs+crestMs?'crest':elapsed<chargeMs+crestMs+revealMs?'revealing':elapsed<total?'settling':'complete'};
}
const routes=[
  [[-20,660],[80,285],[340,120],[610,165],[850,65],[1170,180],[1300,450],[1400,590]],
  [[-10,390],[125,650],[75,920],[290,1110],[640,1140],[860,1040],[1180,1100],[1370,875]],
  [[390,55],[610,180],[850,95],[1170,100],[1380,350],[1280,560],[1390,790],[1190,1030]],
];
function smoothPath(points){
  let d=`M${points[0][0]},${points[0][1]}`;
  for(let i=0;i<points.length-1;i++){
    const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],e=points[Math.min(points.length-1,i+2)];
    d+=` C${b[0]+(c[0]-a[0])/6},${b[1]+(c[1]-a[1])/6} ${c[0]-(e[0]-b[0])/6},${c[1]-(e[1]-b[1])/6} ${c[0]},${c[1]}`;
  }
  return d;
}
const paths=routes.map(smoothPath);
export function lightThreads(value,intensity){
  const progress=clamp(Number.isFinite(value)?value:0),light=clamp(Number.isFinite(intensity)?intensity:0);
  const opacity=Math.sin(Math.PI*progress)**.7*light;
  return paths.map((d,i)=>({d,opacity:progress===0||progress===1?0:opacity,width:2.5,x:Math.sin(progress*.8+i*1.2)*11,y:Math.cos(progress*.7+i)*13,offset:180-progress*250-i*160,core:i===1?'#ffe4aa':'#fff9e7'}));
}
