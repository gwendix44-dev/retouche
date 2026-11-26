// Shaders GLSL ES 3.00 — pipeline de retouche
export const VS = `#version 300 es
precision highp float;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 o;
`;

// ---------- 1. Géométrie : rotation, perspective, recadrage, rééchantillonnage ----------
export const FS_GEOM = HEAD + `
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform mat3 uH;          // px sortie (échelle 1) -> px source
uniform vec2 uOrigin;     // origine de la tuile en px de sortie (échelle uScale)
uniform float uScale;
uniform float uLod;
vec4 fetchC(ivec2 p){ return texelFetch(uSrc, clamp(p, ivec2(0), ivec2(uSrcSize)-1), 0); }
vec4 catmull(float t){
  float t2=t*t, t3=t2*t;
  return vec4(-0.5*t3+t2-0.5*t, 1.5*t3-2.5*t2+1.0, -1.5*t3+2.0*t2+0.5*t, 0.5*t3-0.5*t2);
}
void main(){
  vec2 q = (gl_FragCoord.xy + uOrigin) / uScale;
  vec3 p = uH * vec3(q, 1.0);
  vec2 s = p.xy / p.z;
  vec4 c;
  if (uLod > 0.01) {
    c = textureLod(uSrc, s / uSrcSize, uLod);
  } else {
    vec2 pc = s - 0.5; vec2 f = fract(pc); ivec2 i0 = ivec2(floor(pc));
    vec4 wx = catmull(f.x), wy = catmull(f.y);
    c = vec4(0.0);
    for (int j=0;j<4;j++){
      vec4 row = vec4(0.0);
      for (int i=0;i<4;i++) row += fetchC(i0+ivec2(i-1,j-1)) * wx[i];
      c += row * wy[j];
    }
    c = clamp(c, 0.0, 1.0);
  }
  o = vec4(c.rgb, 1.0);
}`;

// ---------- 2. Réduction du bruit (NLM allégé luminance + bilatéral chroma) ----------
export const FS_DENOISE = HEAD + `
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uL;      // force luminance 0..1
uniform float uC;      // force couleur 0..1
uniform float uKeep;   // détail conservé 0..1
uniform int uRad;      // rayon de recherche 1..3
uniform float uPx;     // taille pixel relative (échelle)
vec3 toY(vec3 c){ float y=dot(c,vec3(0.299,0.587,0.114)); return vec3(y,(c.b-y)*0.565,(c.r-y)*0.713); }
vec3 fromY(vec3 v){ float r=v.x+v.z/0.713, b=v.x+v.y/0.565; float g=(v.x-0.299*r-0.114*b)/0.587; return vec3(r,g,b); }
vec3 fetchY(ivec2 p){ return toY(texelFetch(uTex, clamp(p, ivec2(0), ivec2(uSize)-1), 0).rgb); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c0 = fetchY(p);
  float y0 = c0.x;
  float yOut = y0;
  if (uL > 0.001) {
    float shadowBoost = mix(1.0, 1.7, 1.0 - smoothstep(0.0, 0.45, y0));
    float h = (0.004 + uL*0.20) * shadowBoost * uPx;
    float h2 = h*h;
    float c1 = fetchY(p+ivec2(1,0)).x, c2 = fetchY(p+ivec2(-1,0)).x, c3 = fetchY(p+ivec2(0,1)).x, c4 = fetchY(p+ivec2(0,-1)).x;
    float sum = y0, wsum = 1.0;
    for (int j=-3;j<=3;j++) for (int i=-3;i<=3;i++){
      if (abs(i)>uRad || abs(j)>uRad || (i==0&&j==0)) continue;
      ivec2 q = p + ivec2(i,j);
      float yq = fetchY(q).x;
      float d = (y0-yq)*(y0-yq)
              + (c1-fetchY(q+ivec2(1,0)).x)*(c1-fetchY(q+ivec2(1,0)).x)
              + (c2-fetchY(q+ivec2(-1,0)).x)*(c2-fetchY(q+ivec2(-1,0)).x)
              + (c3-fetchY(q+ivec2(0,1)).x)*(c3-fetchY(q+ivec2(0,1)).x)
              + (c4-fetchY(q+ivec2(0,-1)).x)*(c4-fetchY(q+ivec2(0,-1)).x);
      d *= 0.2;
      float w = exp(-d / h2);
      sum += w*yq; wsum += w;
    }
    float yn = sum / wsum;
    yOut = mix(yn, y0, uKeep*0.35);
  }
  vec2 cOut = c0.yz;
  if (uC > 0.001) {
    float st = max(0.5, 2.0*uPx) * (0.6 + uC);
    vec2 acc = vec2(0.0); float ws = 0.0;
    for (int j=-2;j<=2;j++) for (int i=-2;i<=2;i++){
      ivec2 q = p + ivec2(floor(vec2(float(i),float(j))*st + 0.5));
      vec3 v = fetchY(q);
      float dy = (v.x - y0);
      float dc = length(v.yz - c0.yz);
      float w = exp(-dy*dy/(0.0035 + 0.02*(1.0-uC))) * exp(-dc*dc/(0.02 + 0.25*uC));
      acc += w*v.yz; ws += w;
    }
    cOut = mix(c0.yz, acc/ws, clamp(uC*1.1,0.0,1.0));
  }
  o = vec4(fromY(vec3(yOut, cOut)), 1.0);
}`;

// ---------- 3. Flou gaussien séparable (lecture sur mip) ----------
export const FS_BLUR2 = HEAD + `
uniform sampler2D uTex;
uniform vec2 uOutSize;
uniform vec2 uStep;     // pas uv (1/taille du niveau lu) * direction
uniform float uSigma;
uniform float uLod;
void main(){
  vec2 uv = gl_FragCoord.xy / uOutSize;
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i=-8;i<=8;i++){
    float w = exp(-float(i*i)/(2.0*uSigma*uSigma));
    acc += w * textureLod(uTex, uv + uStep*float(i), uLod).rgb;
    ws += w;
  }
  o = vec4(acc/ws, 1.0);
}`;

// ---------- 4. Réglages (la grosse passe) ----------
export const FS_GRADE = HEAD + `
uniform sampler2D uT1, uBS, uBM, uBL, uLUT, uMask;
uniform vec2 uSize;
uniform vec2 uOrigin; uniform float uScale;
uniform mat3 uH; uniform vec2 uSrcSize; uniform vec2 uCropSize;
uniform float uMaskOn; uniform int uLN;
uniform vec4 uA, uB, uC, uD, uE;
uniform vec4 uLA[4], uLB[4], uLC[4], uLR[4];
uniform float uHSL[24]; uniform int uHslOn; uniform int uCurveOn;
const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
vec3 toLin(vec3 c){ c=max(c,0.0); return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c){ c=max(c,0.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
vec3 contrastCurve(vec3 x, float k){
  float p = k>0.0 ? 1.0+1.4*k : 1.0/(1.0+1.4*(-k));
  vec3 lo = 0.5*pow(clamp(2.0*x,0.0,1.0), vec3(p));
  vec3 hi = 1.0-0.5*pow(clamp(2.0*(1.0-x),0.0,1.0), vec3(p));
  return mix(lo, hi, step(0.5, x));
}
vec3 rgb2hsv(vec3 c){
  vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+1e-10)), d/(q.x+1e-10), q.x);
}
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.0-3.0); return c.z*mix(vec3(1.),clamp(p-1.0,0.0,1.0),c.y); }
vec3 lutC(vec3 c){
  vec3 x = clamp(c,0.0,1.0)*(255.0/256.0)+0.5/256.0;
  return vec3(texture(uLUT, vec2(x.r,0.5)).r, texture(uLUT, vec2(x.g,0.5)).g, texture(uLUT, vec2(x.b,0.5)).b);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 fq = (gl_FragCoord.xy + uOrigin) / uScale;
  vec3 c0 = texture(uT1, uv).rgb;
  vec3 bs = texture(uBS, uv).rgb, bm = texture(uBM, uv).rgb, bl = texture(uBL, uv).rgb;
  float ex=uA.x, co=uA.y, hi=uA.z, sh=uA.w;
  float wh=uB.x, bk=uB.y, te=uB.z, ti=uB.w;
  float vib=uC.x, sat=uC.y, tex=uC.z, cla=uC.w;
  float shp=uD.x, dhz=uD.y, vig=uD.z, ro=uD.w;
  if (uMaskOn > 0.5 && uLN > 0) {
    vec3 hp = uH * vec3(fq, 1.0);
    vec4 m = texture(uMask, (hp.xy/hp.z) / uSrcSize);
    for (int i=0;i<4;i++){
      if (i >= uLN) break;
      float w = m[i];
      if (uLR[i].y > 0.5) { float dl = abs(dot(c0, vec3(0.2126,0.7152,0.0722)) - uLR[i].x); w *= 1.0 - smoothstep(0.15, 0.35, dl); }
      ex += w*uLA[i].x; co += w*uLA[i].y; hi += w*uLA[i].z; sh += w*uLA[i].w;
      te += w*uLB[i].x; ti += w*uLB[i].y; sat += w*uLB[i].z; cla += w*uLB[i].w;
      shp += w*uLC[i].x; dhz += w*uLC[i].y; tex += w*uLC[i].z; vib += w*uLC[i].w;
    }
  }
  vec3 c = c0;
  // voile / dehaze
  if (abs(dhz) > 0.002) {
    if (dhz > 0.0) {
      float dark = min(min(bl.r,bl.g),bl.b);
      float t = clamp(1.0 - dhz*0.8*dark/0.92, 0.35, 1.0);
      c = (c - 0.92*(1.0-t)) / t;
    } else c = mix(c, vec3(0.8), -dhz*0.35);
  }
  vec3 lin = toLin(c);
  // balance des blancs
  if (abs(te)+abs(ti) > 0.001) {
    vec3 g = vec3(exp2(0.45*te), exp2(-0.3*ti), exp2(-0.45*te));
    g /= dot(g, LW);
    lin *= g;
  }
  lin *= exp2(ex);
  // ombres / hautes lumières (masque tonal semi-local)
  float L = dot(lin, LW);
  float Lg = pow(max(L,0.0), 1.0/2.2);
  float Lb = pow(max(dot(toLin(bl), LW)*exp2(ex), 0.0), 1.0/2.2);
  float Lm = mix(Lg, Lb, 0.5);
  float wH = smoothstep(0.35, 0.95, Lm);
  float wS = 1.0 - smoothstep(0.04, 0.62, Lm);
  lin *= exp2(hi*1.6*wH + sh*1.6*wS);
  c = toSrgb(lin);
  // blancs / noirs
  float bp = -bk*0.10, wp = 1.0 - wh*0.12;
  c = (c - bp) / (wp - bp);
  // contraste
  if (abs(co) > 0.002) { vec3 cc = clamp(c,0.0,1.0); c = contrastCurve(cc, co) + max(c-1.0, 0.0); }
  // courbe des tons
  if (uCurveOn == 1) c = lutC(c);
  // détails (netteté / texture / clarté)
  float Lc = clamp(dot(c, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  float mid = 1.0 - pow(abs(Lc*2.0-1.0), 2.0);
  float dS = dot(c0 - bs, vec3(0.299,0.587,0.114));
  float dM = dot(bs - bm, vec3(0.299,0.587,0.114));
  float dC = dot(bs - bl, vec3(0.299,0.587,0.114));
  float thr = uE.x;
  float sm = smoothstep(thr*0.6, thr*1.6 + 0.0015, abs(dS));
  c += vec3(dS * (shp + uE.y) * 2.6 * sm);
  c += vec3(dM * tex * 1.9);
  c += vec3(dC * cla * 1.7 * mid);
  // mixage HSL
  if (uHslOn == 1) {
    vec3 hsv = rgb2hsv(clamp(c,0.0,1.0));
    float h = hsv.x*360.0;
    float cen[8] = float[8](0.0,30.0,60.0,120.0,180.0,240.0,275.0,315.0);
    float dh=0.0, ds=0.0, dl=0.0, wt=0.0;
    for (int k=0;k<8;k++){
      float d = abs(h - cen[k]); d = min(d, 360.0-d);
      float w = max(0.0, 1.0 - d/50.0);
      dh += w*uHSL[k]; ds += w*uHSL[8+k]; dl += w*uHSL[16+k]; wt += w;
    }
    float gate = smoothstep(0.03, 0.25, hsv.y) * smoothstep(0.02, 0.1, hsv.z);
    wt = max(wt, 1e-3);
    hsv.x = fract(hsv.x + gate*dh/wt*30.0/360.0 + 1.0);
    hsv.y = clamp(hsv.y*(1.0+gate*ds/wt), 0.0, 1.0);
    hsv.z = clamp(hsv.z*(1.0+gate*dl/wt*0.6), 0.0, 1.5);
    c = hsv2rgb(hsv);
  }
  // saturation / vibrance
  {
    float Y = dot(c, LW);
    float mx = max(max(c.r,c.g),c.b), mn = min(min(c.r,c.g),c.b);
    float s = (mx-mn)/(mx+1e-4);
    float f = 1.0 + sat + vib*(1.0 - pow(clamp(s,0.0,1.0), 0.6));
    c = Y + (c - Y)*max(f, 0.0);
  }
  // lumières brûlées : compression douce + retour de teinte
  if (ro > 0.001) {
    float mxc = max(max(c.r,c.g),c.b);
    float knee = 1.0 - 0.32*ro;
    if (mxc > knee) {
      float cap = 1.0 - knee;
      float nm = knee + cap*(1.0 - exp(-(mxc-knee)/cap));
      c *= nm / mxc;
    }
    float mx0 = max(max(c0.r,c0.g),c0.b);
    float clipw = smoothstep(0.90, 1.0, mx0);
    vec3 chrom = bm / max(dot(bm, LW), 1e-3);
    c = mix(c, chrom * dot(c, LW), clipw * ro * 0.65);
  }
  // vignettage
  if (abs(vig) > 0.001) {
    vec2 qn = (fq / uCropSize - 0.5) * 2.0;
    float r = dot(qn, qn) * 0.5;
    c *= 1.0 - vig*0.85*smoothstep(0.15, 1.1, r);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ---------- 5. Sortie 8 bits avec tramage ----------
export const FS_FINAL = HEAD + `
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uInSize;   // taille de la texture lue
void main(){
  vec3 c = texture(uTex, gl_FragCoord.xy / uInSize).rgb;
  float n = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056,0.00583715))));
  o = vec4(clamp(c + (n-0.5)/255.0, 0.0, 1.0), 1.0);
}`;

// ---------- 6. Affichage (zoom/déplacement, avant-après, masque, écrêtage) ----------
export const FS_DISPLAY = HEAD + `
uniform sampler2D uA, uB, uDA, uDB, uMask;
uniform vec2 uView;       // px appareil
uniform vec2 uTexSize;    // proxy
uniform float uSp;        // px proxy par px plein
uniform vec3 uXf;         // echelle, tx, ty (px appareil)
uniform vec2 uCrop;       // taille recadrée (px plein)
uniform float uSplit;     // <0 : aucun ; sinon x en px appareil
uniform int uShowB;
uniform vec4 uDRect; uniform float uDOn, uDMargin, uDScale; uniform vec2 uDSize;
uniform mat3 uH; uniform vec2 uSrcSize; uniform int uMaskCh; uniform float uClip;
uniform vec3 uBg;
vec3 samp(bool before, vec2 full){
  vec3 c;
  if (uDOn > 0.5 && full.x>=uDRect.x && full.y>=uDRect.y && full.x<uDRect.x+uDRect.z && full.y<uDRect.y+uDRect.w) {
    vec2 dpx = (full - uDRect.xy)*uDScale + uDMargin;
    c = before ? texture(uDB, dpx/uDSize).rgb : texture(uDA, dpx/uDSize).rgb;
  } else {
    vec2 uv = full*uSp/uTexSize;
    c = before ? texture(uB, uv).rgb : texture(uA, uv).rgb;
  }
  return c;
}
void main(){
  vec2 vp = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 full = (vp - uXf.yz)/uXf.x;
  if (full.x<0.0||full.y<0.0||full.x>uCrop.x||full.y>uCrop.y){ o=vec4(uBg,1.0); return; }
  bool before = uShowB==1 || (uSplit>=0.0 && vp.x<uSplit);
  vec3 c = samp(before, full);
  if (uClip > 0.5 && !before) {
    float mx = max(max(c.r,c.g),c.b), mn = min(min(c.r,c.g),c.b);
    if (mx > 0.992) c = mix(c, vec3(1.0,0.1,0.1), 0.75);
    else if (mx < 0.012) c = mix(c, vec3(0.1,0.3,1.0), 0.6);
  }
  if (uMaskCh >= 0) {
    vec3 hp = uH * vec3(full, 1.0);
    vec4 m = texture(uMask, (hp.xy/hp.z)/uSrcSize);
    float w = uMaskCh==0?m.r:uMaskCh==1?m.g:uMaskCh==2?m.b:m.a;
    c = mix(c, vec3(1.0,0.12,0.25), 0.55*w);
  }
  if (uSplit >= 0.0 && abs(vp.x-uSplit) < 1.2) c = vec3(1.0);
  float n = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056,0.00583715))));
  o = vec4(clamp(c + (n-0.5)/255.0, 0.0, 1.0), 1.0);
}`;

// ---------- 7. Agrandissement Lanczos-3 + accentuation anti-halo ----------
export const FS_UPSCALE = HEAD + `
uniform sampler2D uTex;
uniform vec2 uInSize;
uniform vec2 uOrigin;   // origine tuile (px sortie)
uniform float uF;       // facteur
uniform float uSharp;   // 0..1
float lz(float x){ x=abs(x); if (x<1e-4) return 1.0; if (x>=3.0) return 0.0; float px=3.14159265*x; return 3.0*sin(px)*sin(px/3.0)/(px*px); }
vec3 fetch(ivec2 p){ return texelFetch(uTex, clamp(p, ivec2(0), ivec2(uInSize)-1), 0).rgb; }
void main(){
  vec2 s = (gl_FragCoord.xy + uOrigin) / uF - 0.5;
  ivec2 i0 = ivec2(floor(s)); vec2 f = s - vec2(i0);
  vec3 acc = vec3(0.0); float ws = 0.0;
  vec3 mn = vec3(1.0), mx = vec3(0.0);
  for (int j=-2;j<=3;j++) for (int i=-2;i<=3;i++){
    float w = lz(float(i)-f.x) * lz(float(j)-f.y);
    vec3 v = fetch(i0+ivec2(i,j));
    acc += w*v; ws += w;
    if (i>=0 && i<=1 && j>=0 && j<=1) { mn = min(mn, v); mx = max(mx, v); }
  }
  vec3 c = acc/ws;
  // limite anti-halo : on borne par le voisinage immédiat
  float k = 0.06 + 0.5*(1.0-uSharp);
  c = clamp(c, mn - k*(mx-mn) - 0.004, mx + k*(mx-mn) + 0.004);
  o = vec4(clamp(c,0.0,1.0), 1.0);
}`;

// ---------- 8. Empilement : moyenne glissante avec rejet des objets mobiles ----------
export const FS_STACK = HEAD + `
uniform sampler2D uAcc, uFrame;
uniform vec2 uOffset;     // décalage px (alignement)
uniform vec2 uSize;
uniform float uN;         // numéro de l'image (1 = première)
uniform float uThr;       // seuil de rejet (0 = aucun)
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 acc = texture(uAcc, uv).rgb;
  vec3 f = texture(uFrame, (gl_FragCoord.xy + uOffset)/uSize).rgb;
  float w = 1.0;
  if (uThr > 0.0 && uN > 1.5) {
    float d = max(max(abs(f.r-acc.r),abs(f.g-acc.g)),abs(f.b-acc.b));
    w = 1.0 - smoothstep(uThr, uThr*2.0, d);
  }
  vec3 outc = uN < 1.5 ? f : acc + (f - acc) * (w / uN);
  o = vec4(outc, 1.0);
}`;

export const FS_COPY = HEAD + `
uniform sampler2D uTex; uniform vec2 uInSize; uniform vec2 uOff;
void main(){ o = vec4(texture(uTex, (gl_FragCoord.xy+uOff)/uInSize).rgb,1.0); }`;
