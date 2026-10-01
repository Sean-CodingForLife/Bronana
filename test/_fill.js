// 当前 R.resize 的策略：dpr = min(2, devicePixelRatio)
function cur(w,h,dpr){ const d=Math.min(2,dpr); return {dpr:d, px:w*h*d*d}; }
console.log('=== 填充率现状（每帧至少一次全屏绘制的像素量）===\n');
console.log('显示器/窗口                 dpr   画布像素     相对 1080p');
const base = 1920*1080;
for(const [name,w,h,dpr] of [
  ['1366×768 @1',1366,768,1],
  ['1920×1080 @1',1920,1080,1],
  ['1920×1080 @2（常见 4K 缩放）',1920,1080,2],
  ['2560×1440 @1',2560,1440,1],
  ['2560×1440 @2',2560,1440,2],
  ['3840×2160 @1',3840,2160,1]
]){
  const r=cur(w,h,dpr);
  console.log(name.padEnd(28)+String(r.dpr).padEnd(7)+(r.px/1e6).toFixed(2)+'M'.padEnd(8)+
    '  '+(r.px/base).toFixed(2)+'×');
}
console.log('\n每帧的着色遍数（叠加）：');
console.log('  clearRect 1 遍（冗余：紧接着就被不透明底色盖住）');
console.log('  底色 fillRect 1 遍');
console.log('  地面烘焙 blit 1 遍');
console.log('  道具烘焙 blit 1 遍');
console.log('  → 静态背景就要 4 遍全屏，其中 1 遍纯属浪费');
console.log('\n4K@2 这一档：8.29M 像素 × 60fps = 4.97 亿像素/秒（仅背景）');
console.log('dpr=1.34 封顶后：3.72M × 60 = 2.23 亿像素/秒 → 填充率降到 45%');
console.log('\n另外还在用默认设置的两项：');
console.log('  · getContext("2d") 没传 {alpha:false} → 画布与页面背景做逐像素混合');
console.log('  · imageSmoothingEnabled 默认 true → 每个怪物贴图（1.045 挤压）都走双线性重采样');
