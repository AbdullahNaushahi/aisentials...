import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://wjhpodrejhynbojtavvo.supabase.co";
const SUPABASE_ANON_KEY =
  (typeof process !== "undefined" && (process.env?.REACT_APP_SUPABASE_ANON_KEY || process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY)) ||
  (typeof window !== "undefined" && window.__ENV__?.SUPABASE_ANON_KEY) ||
  "";

const supabase = SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

async function sbSignUp(email, password, fullName) {
  if (!supabase) return { error: { message: "Supabase not configured" } };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error };
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id, full_name: fullName, email,
      is_king: false, audits_today: 0, last_audit_date: null,
    });
  }
  return { data, error: null };
}

async function sbSignIn(email, password) {
  if (!supabase) return { error: { message: "Supabase not configured" } };
  return supabase.auth.signInWithPassword({ email, password });
}

async function sbSignOut() {
  if (!supabase) return;
  return supabase.auth.signOut();
}

async function sbFetchProfile(userId) {
  if (!supabase) return { data: null, error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_king, audits_today, last_audit_date")
    .eq("id", userId)
    .single();
  return { data, error };
}

async function sbEnsureProfile(user) {
  if (!supabase) return;
  const { data: existing } = await supabase.from("profiles").select("id").eq("id", user.id).single();
  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Founder",
      email: user.email, is_king: false, audits_today: 0, last_audit_date: null,
    });
  }
}

function sbSubscribeProfile(userId, callback) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`king-profile:${userId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => callback(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

async function sbTryRunAudit(userId, isKing) {
  if (isKing) return { allowed: true };
  if (!supabase) return { allowed: true }; // dev fallback
  const { data, error } = await supabase.rpc("increment_audit", { user_id: userId });
  if (error) return { allowed: false, error };
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// KING CONTEXT — single source of truth for membership state
// ═══════════════════════════════════════════════════════════════════
const KingCtx = createContext({
  isKing: false, profile: null, sbUser: null,
  showPaywall: () => {}, setProfile: () => {},
});

function useKing() { return useContext(KingCtx); }

// ═══════════════════════════════════════════════════════════════════
// SEED-BASED RANDOMNESS
// ═══════════════════════════════════════════════════════════════════
function seededRng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return function () {
    h += h << 13; h ^= h >> 7; h += h << 3; h ^= h >> 17; h += h << 5;
    return ((h >>> 0) / 4294967295);
  };
}
function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// ═══════════════════════════════════════════════════════════════════
// CONTENT FRAGMENTS (20 per category)
// ═══════════════════════════════════════════════════════════════════
const FRAGMENTS = {
  openers: ["For a [niche] powerhouse like [brand], the first move is","The [niche] market is primed for disruption — [brand]'s edge comes from","Most [niche] brands miss this completely, but [brand] can dominate by","[brand] has a rare opportunity in [niche] to","In 2026, the highest-ROI play for [brand] in [niche] is","What separates winning [niche] brands from losers is — [brand] should focus on","The secret top [niche] sellers don't share: [brand] needs to","Before anything else, [brand] must establish","[brand] enters [niche] at the perfect moment to","The one thing holding back most [niche] founders is what [brand] will solve by","Smart [niche] builders in 2026 start with what [brand] already has:","The asymmetric advantage [brand] has in [niche] right now is","When [brand] shows up in [niche], customers will notice","The fastest path to [niche] profits for [brand] is","Zero-to-revenue in [niche] means [brand] should immediately","Top [niche] brands spend 80% of effort on what [brand] will master:","[brand]'s unfair advantage in [niche] comes down to","The market is telling [niche] founders like [brand] to prioritize","The compounding play for [brand] in [niche] starts with","Data from 10,000+ [niche] brands shows [brand]'s best path is"],
  actions: ["launch a viral loop content strategy","build social proof before spending on ads","dominate one micro-platform before expanding","create a signature customer experience moment","capture emails at every touchpoint aggressively","test 3 price points simultaneously","partner with one nano-influencer this week","design an irresistible free value offer","systemize the first 10 customer journeys","create a community before the product launch","map the top 3 competitor gaps and fill them","build an automated DM funnel today","run a 48-hour flash sale to generate early data","craft a brand origin story that converts","set up retargeting pixels on day one","publish daily content for 21 straight days","create a referral loop into the core product","build the upsell stack before the main offer","establish a signature hashtag with 30 posts","activate a waitlist to create scarcity"],
  successMetrics: ["3x ROAS within 14 days","1,000 organic followers in 30 days","$500 revenue in the first week","50% email open rate consistently","25% cart recovery rate via automation","10 UGC posts from real customers","sub-2% refund rate from day one","4.8★ average product review score","$15 average customer acquisition cost","40% repeat purchase rate by month 2","5,000 impressions per Reel consistently","20% conversion rate on DM inquiries","$3,000 monthly recurring revenue goal","100 email subscribers in week one","60% profit margin maintained at scale","3 influencer collaborations in month one","viral content piece hitting 100K views","2x revenue week-over-week for 4 weeks","50 5-star reviews on the storefront","daily revenue exceeding product cost by 5x"],
  nextSteps: ["Schedule your first 7 posts using the content calendar above.","Open Lovable.dev and paste your website prompt to go live today.","DM 5 nano-influencers in your niche before bed tonight.","Set up your Stripe account and test a $1 transaction.","Write your brand story in 3 sentences and pin it to your Instagram.","Order 3 product samples to film authentic content this week.","Create a 'Coming Soon' story poll to build pre-launch hype.","Join 2 Facebook groups in your niche and add genuine value daily.","Set a Google Alert for your top 3 competitors to track their moves.","Film a raw, unfiltered 60-second brand intro video today.","Build your email list with a free checklist or mini-guide offer.","Message your first 20 followers personally with a thank-you.","Run a $5/day Meta ad test on your best-performing organic post.","Create a highlight bubble on Instagram for customer testimonials.","Set up a WhatsApp Business account with an auto-reply greeting.","Design your packaging insert to include a QR review request.","Post your first TikTok with trending audio by end of today.","Build a 3-email welcome sequence in your email platform.","Price your upsell bundle and add it to your store checkout.","Track your revenue daily in the dashboard — momentum is data."],
};

function generateUniqueResponse(brandName, niche, toolType) {
  const seed = `${brandName}-${niche}-${toolType}`;
  const rng = seededRng(seed);
  const opener = pick(FRAGMENTS.openers, rng).replace(/\[brand\]/g, brandName).replace(/\[niche\]/g, niche);
  return { opener, action: pick(FRAGMENTS.actions, rng), metric: pick(FRAGMENTS.successMetrics, rng), next: pick(FRAGMENTS.nextSteps, rng) };
}

// ═══════════════════════════════════════════════════════════════════
// DYNAMIC SVG LOGO GENERATOR
// ═══════════════════════════════════════════════════════════════════
const LOGO_STYLES = [
  { id:"minimal-luxury", label:"Minimal Luxury", desc:"Clean, refined, timeless" },
  { id:"modern-tech", label:"Modern Tech", desc:"Sharp, geometric, digital-native" },
  { id:"bold-startup", label:"Bold Startup", desc:"Energetic, punchy, viral-ready" },
  { id:"elegant-brand", label:"Elegant Brand", desc:"Sophisticated, premium, editorial" },
];

function generateLogoSVG(brandName, niche, style, rng) {
  const initial = brandName[0].toUpperCase();
  const short = brandName.length > 8 ? brandName.slice(0, 6) + "…" : brandName;
  const r = () => rng();
  const palettes = {
    "minimal-luxury":[["#e8e0ff","#7c5cfc","#0a0a1a"],["#fff8e8","#f5c842","#0f0d05"],["#e8fff8","#22d3a6","#030f0a"],["#ffe8f0","#f43f5e","#0f0308"]],
    "modern-tech":[["#00f0ff","#0066ff","#000820"],["#a8ff78","#00c9ff","#001020"],["#ff6b35","#f7c59f","#0a0500"],["#c471ed","#12c2e9","#050010"]],
    "bold-startup":[["#ff6b6b","#feca57","#1a0500"],["#48dbfb","#ff9ff3","#000a10"],["#ff9f43","#ee5a24","#0f0400"],["#0be881","#0fbcf9","#000f08"]],
    "elegant-brand":[["#e0c9a6","#b89860","#080602"],["#c9d6df","#52616b","#0a0c0e"],["#f5e6ca","#d4a853","#0e0900"],["#d7c4f0","#9b6dff","#07040f"]],
  };
  const pal = palettes[style][Math.floor(r() * 4)];
  const [accent, mid, bg] = pal;
  const iconType = Math.floor(r() * 5);
  const angle = Math.floor(r() * 360);
  const size = 38 + Math.floor(r() * 14);
  let iconSVG = "";
  if (iconType === 0) {
    const pts = Array.from({length:6},(_,i)=>{const a=(i*60+angle)*Math.PI/180;return`${50+size*Math.cos(a)},${50+size*Math.sin(a)}`;}).join(" ");
    iconSVG = `<polygon points="${pts}" fill="none" stroke="${accent}" stroke-width="2.5"/><text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="28" font-weight="800" fill="${accent}" font-family="sans-serif">${initial}</text>`;
  } else if (iconType === 1) {
    iconSVG = `<circle cx="50" cy="50" r="${size}" fill="none" stroke="${accent}" stroke-width="2.5"/><circle cx="50" cy="50" r="${size-10}" fill="${accent}22"/><text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="30" font-weight="800" fill="${accent}" font-family="sans-serif">${initial}</text>`;
  } else if (iconType === 2) {
    iconSVG = `<polygon points="50,${50-size} ${50+size},50 50,${50+size} ${50-size},50" fill="${accent}22" stroke="${accent}" stroke-width="2"/><text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="26" font-weight="800" fill="${accent}" font-family="sans-serif">${initial}</text>`;
  } else if (iconType === 3) {
    iconSVG = `<rect x="${50-size}" y="${50-size}" width="${size*2}" height="${size*2}" rx="14" fill="${accent}22" stroke="${accent}" stroke-width="2"/><text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-size="30" font-weight="800" fill="${accent}" font-family="sans-serif">${initial}</text>`;
  } else {
    iconSVG = `<polygon points="50,${50-size} ${50+size*0.866},${50+size*0.5} ${50-size*0.866},${50+size*0.5}" fill="${accent}22" stroke="${accent}" stroke-width="2"/><text x="50" y="60" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="800" fill="${accent}" font-family="sans-serif">${initial}</text>`;
  }
  const fontStyles = {"minimal-luxury":{weight:"300",spacing:"0.15em",size:18},"modern-tech":{weight:"700",spacing:"0.08em",size:20},"bold-startup":{weight:"900",spacing:"-0.02em",size:22},"elegant-brand":{weight:"400",spacing:"0.2em",size:17}};
  const fs = fontStyles[style];
  const fullSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160"><defs><linearGradient id="bg-${style}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${bg}ee"/></linearGradient><filter id="glow-${style}"><feGaussianBlur stdDeviation="3" result="blur"/><feComposite in="SourceGraphic" in2="blur" operator="over"/></filter></defs><rect width="320" height="160" fill="url(#bg-${style})" rx="16"/><rect width="320" height="160" fill="${accent}08" rx="16"/><g transform="translate(30,0)" filter="url(#glow-${style})"><g transform="scale(0.75)">${iconSVG}</g></g><text x="116" y="72" font-family="Georgia, serif" font-size="${fs.size}" font-weight="${fs.weight}" letter-spacing="${fs.spacing}" fill="${pal[0]}" dominant-baseline="middle">${short.toUpperCase()}</text><text x="118" y="98" font-family="Georgia, serif" font-size="9" font-weight="300" letter-spacing="0.25em" fill="${mid}" dominant-baseline="middle" opacity="0.7">${niche.toUpperCase().slice(0,20)}</text><line x1="116" y1="108" x2="${116+Math.min(short.length*fs.size*0.6,160)}" y2="108" stroke="${accent}" stroke-width="0.8" opacity="0.5"/></svg>`;
  return { svg: fullSVG, accent, bg, mid };
}

function generateAllLogos(brandName, niche) {
  return LOGO_STYLES.map(style => {
    const rng = seededRng(`${brandName}-${niche}-${style.id}-logo`);
    const { svg, accent, bg } = generateLogoSVG(brandName, niche, style.id, rng);
    return { ...style, svg, accent, bg };
  });
}

function svgToDataUrl(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
function downloadSVG(svg, name) { const b=new Blob([svg],{type:"image/svg+xml"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`${name}-logo.svg`;a.click();URL.revokeObjectURL(u); }
async function downloadPNG(svg, name) { const c=document.createElement("canvas");c.width=640;c.height=320;const ctx=c.getContext("2d");const img=new Image();img.onload=()=>{ctx.drawImage(img,0,0,640,320);const a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=`${name}-logo.png`;a.click()};img.src=svgToDataUrl(svg); }

// ═══════════════════════════════════════════════════════════════════
// CLAUDE API
// ═══════════════════════════════════════════════════════════════════
async function callClaude(prompt) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:"You are an elite AI business strategist for Aisentials. Respond with valid JSON only. No markdown, no backticks, no preamble.", messages:[{role:"user",content:prompt}] }),
    });
    const data = await res.json();
    const text = data.content?.map(b=>b.text||"").join("")||"{}";
    return JSON.parse(text.replace(/```json|```/g,"").trim());
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════
const T = {
  bg:"#060612", surface:"#0d0d24", card:"#12122e",
  border:"#1e1e50", accent:"#7c5cfc", accentB:"#a855f7",
  gold:"#f5c842", goldB:"#f97316", green:"#22d3a6",
  red:"#ff5c87", text:"#eeeeff", muted:"#6b6b9a", subtle:"#1a1a40",
};

// ═══════════════════════════════════════════════════════════════════
// MOTION VARIANTS
// ═══════════════════════════════════════════════════════════════════
const fadeUp  = { hidden:{opacity:0,y:28}, show:{opacity:1,y:0,transition:{duration:.5,ease:[.16,1,.3,1]}} };
const fadeIn  = { hidden:{opacity:0},      show:{opacity:1,transition:{duration:.35}} };
const stagger = { show:{transition:{staggerChildren:.08}} };
const scaleIn = { hidden:{opacity:0,scale:.92}, show:{opacity:1,scale:1,transition:{duration:.4,ease:[.16,1,.3,1]}} };

// ═══════════════════════════════════════════════════════════════════
// GLOBAL CSS (existing + KING additions)
// ═══════════════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:${T.bg};--surface:${T.surface};--card:${T.card};--border:${T.border};--accent:${T.accent};--gold:${T.gold};--green:${T.green};--red:${T.red};--text:${T.text};--muted:${T.muted}}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;min-height:100vh;overflow-x:hidden}
h1,h2,h3,h4,h5{font-family:'Bricolage Grotesque',sans-serif}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--accent);border-radius:2px}
::selection{background:${T.accent}44}
.noise::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.025;z-index:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.mesh-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 50% at 20% 0%,${T.accent}18 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 100%,${T.accentB}12 0%,transparent 55%),radial-gradient(ellipse 40% 60% at 60% 40%,#06b6d414 0%,transparent 50%),var(--bg)}
.glass-card{background:rgba(18,18,46,.6);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(124,92,252,.15);border-radius:20px}
.solid-card{background:var(--card);border:1px solid var(--border);border-radius:20px}
.card-hover{transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
.card-hover:hover{transform:translateY(-3px);border-color:rgba(124,92,252,.4);box-shadow:0 20px 60px rgba(124,92,252,.12)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;cursor:pointer;font-family:'Bricolage Grotesque',sans-serif;font-weight:600;transition:all .2s ease;text-decoration:none;white-space:nowrap;position:relative;overflow:hidden}
.btn::after{content:'';position:absolute;inset:0;opacity:0;background:white;transition:opacity .2s}
.btn:active::after{opacity:.06}
.btn-primary{background:linear-gradient(135deg,${T.accent},${T.accentB});color:#fff;padding:13px 28px;border-radius:12px;font-size:15px;box-shadow:0 0 30px ${T.accent}44}
.btn-primary:hover{box-shadow:0 0 50px ${T.accent}66;transform:translateY(-2px)}
.btn-ghost{background:transparent;color:var(--text);border:1px solid var(--border);padding:12px 24px;border-radius:12px;font-size:14px}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.btn-gold{background:linear-gradient(135deg,${T.gold},${T.goldB});color:#000;font-weight:700;padding:12px 24px;border-radius:12px;font-size:14px}
.btn-sm{padding:9px 18px!important;font-size:13px!important;border-radius:10px!important}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.input{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:13px 16px;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s}
.input:focus{border-color:var(--accent);box-shadow:0 0 0 3px ${T.accent}22}
.input::placeholder{color:var(--muted)}
select.input{cursor:pointer}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.badge-purple{background:${T.accent}20;color:${T.accent};border:1px solid ${T.accent}35}
.badge-green{background:${T.green}18;color:${T.green};border:1px solid ${T.green}35}
.badge-gold{background:${T.gold}18;color:${T.gold};border:1px solid ${T.gold}35}
.badge-red{background:${T.red}18;color:${T.red};border:1px solid ${T.red}35}
.progress-track{height:3px;background:var(--border);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--accent),${T.accentB});border-radius:2px;transition:width .6s cubic-bezier(.16,1,.3,1)}
.sidebar{width:256px;background:rgba(13,13,36,.95);backdrop-filter:blur(20px);border-right:1px solid var(--border);height:100vh;position:fixed;left:0;top:0;z-index:100;display:flex;flex-direction:column;overflow-y:auto}
.nav-item{display:flex;align-items:center;gap:11px;padding:10px 16px;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:500;color:var(--muted);transition:all .15s;margin:1px 8px}
.nav-item:hover{background:rgba(124,92,252,.08);color:var(--text)}
.nav-item.active{background:${T.accent}18;color:var(--accent);font-weight:600}
.nav-icon{font-size:16px;width:20px;text-align:center;flex-shrink:0}
.m-header{display:none;position:fixed;top:0;left:0;right:0;z-index:200;height:60px;background:rgba(6,6,18,.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);padding:0 20px;align-items:center;justify-content:space-between}
.overlay-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99;backdrop-filter:blur(4px)}
@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
.skeleton{background:linear-gradient(90deg,var(--border) 25%,${T.subtle} 50%,var(--border) 75%);background-size:400px 100%;animation:shimmer 1.4s infinite;border-radius:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:32px;height:32px;border:2.5px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
.bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px}
.bar{width:100%;border-radius:5px 5px 0 0;transition:height .6s cubic-bezier(.16,1,.3,1),background .3s}
.cal-cell{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px;cursor:pointer;min-height:64px;transition:all .15s}
.cal-cell:hover{border-color:var(--accent);transform:scale(1.03)}
.cal-cell.done{border-color:${T.green}60;background:${T.green}0a}
.cal-cell.open{border-color:${T.accent}60;background:${T.accent}0a}
.divider{height:1px;background:var(--border)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:var(--surface);border:1px solid var(--border);border-radius:999px;font-size:13px;color:var(--text)}
.logo-card{background:var(--card);border:2px solid var(--border);border-radius:18px;padding:20px;cursor:pointer;transition:all .2s ease;position:relative;overflow:hidden}
.logo-card:hover{border-color:${T.accent}70;transform:translateY(-4px);box-shadow:0 16px 48px ${T.accent}18}
.logo-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 16px 48px ${T.accent}30}
.logo-card.selected::after{content:'✓';position:absolute;top:12px;right:14px;background:var(--accent);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
.niche-card{background:var(--card);border:1.5px solid var(--border);border-radius:18px;padding:20px;cursor:pointer;transition:all .2s}
.niche-card:hover{border-color:${T.accent}60;transform:translateY(-3px);box-shadow:0 12px 40px ${T.accent}18}
.niche-card.selected{border-color:var(--accent);background:linear-gradient(135deg,${T.accent}12,var(--card))}
.brand-card{background:var(--card);border:1.5px solid var(--border);border-radius:14px;padding:18px 22px;cursor:pointer;transition:all .18s}
.brand-card:hover,.brand-card.selected{border-color:var(--accent);background:${T.accent}0f}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 24px;transition:border-color .2s}
.stat-card:hover{border-color:${T.accent}40}
@keyframes aiPulse{0%,100%{opacity:.5;transform:scale(.95)}50%{opacity:1;transform:scale(1.02)}}
.ai-thinking{animation:aiPulse 1.4s ease-in-out infinite}
@keyframes dotPulse{0%,80%,100%{transform:scale(0);opacity:.3}40%{transform:scale(1);opacity:1}}
.dot-pulse span{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin:0 3px;animation:dotPulse 1.2s ease-in-out infinite}
.dot-pulse span:nth-child(2){animation-delay:.2s}
.dot-pulse span:nth-child(3){animation-delay:.4s}
.grad-text{background:linear-gradient(135deg,var(--accent),${T.accentB},${T.gold});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* ══ KING MEMBERSHIP CSS ══════════════════════════════════════════ */

/* Crown badge glow */
@keyframes crownGlow{0%,100%{filter:drop-shadow(0 0 4px ${T.gold}) drop-shadow(0 0 8px ${T.gold}60)}50%{filter:drop-shadow(0 0 8px ${T.gold}) drop-shadow(0 0 20px ${T.gold}80)}}
.king-crown{display:inline-block;animation:crownGlow 2s ease-in-out infinite;font-size:16px;line-height:1;cursor:default;user-select:none}
.king-badge-inline{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,${T.gold}22,${T.goldB}14);border:1px solid ${T.gold}50;border-radius:999px;padding:3px 10px 3px 7px;font-size:11px;font-weight:700;color:${T.gold};letter-spacing:.04em}

/* Sidebar KING banner */
.king-sidebar-banner{margin:8px;background:linear-gradient(135deg,${T.gold}20,${T.goldB}12);border:1px solid ${T.gold}40;border-radius:12px;padding:10px 14px;text-align:center}
.king-sidebar-banner .king-title{font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;color:${T.gold};margin-bottom:2px}
.king-sidebar-banner .king-sub{font-size:11px;color:${T.muted}}
.free-sidebar-banner{margin:8px;background:rgba(124,92,252,.08);border:1px solid ${T.accent}30;border-radius:12px;padding:10px 14px;text-align:center;cursor:pointer;transition:all .2s}
.free-sidebar-banner:hover{border-color:${T.gold};background:${T.gold}10}
.free-sidebar-banner .free-title{font-size:12px;font-weight:700;color:${T.muted};margin-bottom:3px}
.free-sidebar-banner .free-cta{font-size:11px;color:${T.gold};font-weight:600}

/* Locked feature wrapper */
.locked-wrapper{position:relative;border-radius:20px;overflow:hidden}
.locked-blur{filter:blur(5px);pointer-events:none;user-select:none;opacity:.6;transition:filter .3s}
.locked-overlay{position:absolute;inset:0;background:rgba(6,6,18,.7);backdrop-filter:blur(2px);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;transition:background .2s;z-index:10}
.locked-overlay:hover{background:rgba(6,6,18,.8)}
.locked-icon{font-size:32px;filter:drop-shadow(0 0 12px ${T.gold})}
.locked-text{font-family:'Bricolage Grotesque',sans-serif;font-size:14px;font-weight:700;color:${T.gold};text-align:center;letter-spacing:.02em}
.locked-sub{font-size:12px;color:${T.muted};text-align:center}

/* Audit limit bar */
.audit-bar{background:${T.card};border:1px solid ${T.border};border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:12px;margin-bottom:16px}
.audit-used{background:${T.gold}30;border:1px solid ${T.gold}50;color:${T.gold}}
.audit-free{background:${T.green}18;border:1px solid ${T.green}40;color:${T.green}}

/* Paywall modal */
.paywall-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px}
.paywall-modal{background:linear-gradient(160deg,#0e0e28 0%,#12102a 50%,#0e0a1c 100%);border:1px solid ${T.gold}40;border-radius:24px;padding:36px 32px;max-width:480px;width:100%;position:relative;box-shadow:0 40px 120px rgba(0,0,0,.8),0 0 80px ${T.gold}18;overflow:hidden}
.paywall-modal::before{content:'';position:absolute;top:-60px;right:-60px;width:200px;height:200px;background:radial-gradient(circle,${T.gold}18 0%,transparent 70%);pointer-events:none}
.paywall-modal::after{content:'';position:absolute;bottom:-40px;left:-40px;width:150px;height:150px;background:radial-gradient(circle,${T.accent}14 0%,transparent 70%);pointer-events:none}
.paywall-close{position:absolute;top:14px;right:16px;background:none;border:none;color:${T.muted};font-size:20px;cursor:pointer;transition:color .15s;z-index:1}
.paywall-close:hover{color:${T.text}}
.paywall-crown{font-size:48px;text-align:center;margin-bottom:12px;animation:crownGlow 1.8s ease-in-out infinite}
.paywall-title{font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(20px,4vw,26px);font-weight:800;text-align:center;background:linear-gradient(135deg,${T.gold},${T.goldB});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.2;margin-bottom:8px}
.paywall-pricing{text-align:center;margin:14px 0;padding:14px 20px;background:${T.gold}10;border:1px solid ${T.gold}30;border-radius:12px}
.paywall-price-old{font-size:14px;color:${T.muted};text-decoration:line-through}
.paywall-price-new{font-size:22px;font-weight:800;color:${T.gold};font-family:'Bricolage Grotesque',sans-serif}
.paywall-price-label{font-size:12px;color:${T.gold};opacity:.8;margin-top:2px}
.paywall-trust{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:16px 0}
.trust-badge{display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);border:1px solid ${T.border};border-radius:8px;padding:7px 12px;font-size:12px;color:${T.muted}}
.trust-badge span{color:${T.green};font-size:14px}
.paywall-note{font-size:12px;color:${T.muted};text-align:center;margin:12px 0 20px;line-height:1.6;padding:10px 14px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid ${T.border}}
.paywall-note strong{color:${T.gold}}
.btn-king{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:17px 28px;background:linear-gradient(135deg,${T.gold},${T.goldB});color:#000;font-family:'Bricolage Grotesque',sans-serif;font-size:17px;font-weight:800;border:none;border-radius:14px;cursor:pointer;letter-spacing:.02em;box-shadow:0 0 40px ${T.gold}55,0 8px 30px rgba(0,0,0,.4);transition:all .22s ease;text-decoration:none}
.btn-king:hover{box-shadow:0 0 70px ${T.gold}88,0 12px 40px rgba(0,0,0,.5);transform:scale(1.025) translateY(-2px)}
.btn-king:active{transform:scale(.98)}

/* Nav lock indicator */
.nav-lock{margin-left:auto;font-size:11px;opacity:.5}

@media(max-width:768px){
  .sidebar{transform:translateX(-100%);transition:transform .3s cubic-bezier(.16,1,.3,1)}
  .sidebar.open{transform:translateX(0)}
  .main-content{margin-left:0!important;padding:80px 16px 32px!important}
  .m-header{display:flex}
  .overlay-bg{display:block}
  .grid-2,.grid-3,.grid-4{grid-template-columns:1fr!important}
  .hide-mobile{display:none!important}
  .cal-grid{grid-template-columns:repeat(5,1fr)!important}
  .full-mobile{width:100%!important}
  .paywall-modal{padding:28px 20px}
}
@media(min-width:769px){.overlay-bg{display:none!important}}
`;

// ═══════════════════════════════════════════════════════════════════
// KING MEMBERSHIP COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function KingBadge() {
  return (
    <div className="king-badge-inline">
      <span className="king-crown">👑</span>
      KING
    </div>
  );
}

function PaywallModal({ onClose }) {
  return (
    <AnimatePresence>
      <motion.div className="paywall-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div className="paywall-modal" initial={{ opacity: 0, scale: .88, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .92, y: 20 }}
          transition={{ duration: .4, ease: [.16, 1, .3, 1] }}>

          <button className="paywall-close" onClick={onClose}>✕</button>

          <div className="paywall-crown">👑</div>

          <h2 className="paywall-title">CLAIM YOUR<br />KING ACCESS PASS</h2>

          <div className="paywall-pricing">
            <div className="paywall-price-old">Normally $15/month</div>
            <div className="paywall-price-new">$10/month</div>
            <div className="paywall-price-label">⚡ Limited Loyalty Offer — for you only!</div>
          </div>

          <div className="paywall-trust">
            {[["✅","Trusted by 10,000+ founders"],["🛡️","Verified Secure Payment"],["🔒","100% Safe Checkout"]].map(([icon,text]) => (
              <div key={text} className="trust-badge"><span>{icon}</span>{text}</div>
            ))}
          </div>

          <div className="paywall-note">
            <strong>⚡ Instant Activation:</strong> Your KING status will be activated automatically within 60 seconds of successful purchase.
          </div>

          <motion.a
            href="https://aisentialsofficial.gumroad.com/l/kingaccesspass?wanted=true"
            target="_blank" rel="noreferrer"
            className="btn-king"
            whileHover={{ scale: 1.025 }} whileTap={{ scale: .97 }}
          >
            <span>👑</span>
            BUY KING ACCESS NOW
            <span style={{ fontSize: 14 }}>→</span>
          </motion.a>

          <p style={{ fontSize: 11, color: T.muted, textAlign: "center", marginTop: 12 }}>
            Secure payment via Gumroad. Cancel anytime.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Wraps any feature section with blur + lock overlay for free users
function LockedFeature({ children, label = "KING Feature" }) {
  const { isKing, showPaywall } = useKing();
  if (isKing) return children;
  return (
    <div className="locked-wrapper">
      <div className="locked-blur">{children}</div>
      <div className="locked-overlay" onClick={showPaywall}>
        <div className="locked-icon">👑</div>
        <div className="locked-text">{label}</div>
        <div className="locked-sub">Upgrade to KING Membership to unlock</div>
        <motion.button className="btn btn-sm" style={{ background: `linear-gradient(135deg,${T.gold},${T.goldB})`, color: "#000", fontWeight: 700, marginTop: 4 }}
          whileHover={{ scale: 1.05 }} whileTap={{ scale: .96 }}>
          👑 Get KING Access
        </motion.button>
      </div>
    </div>
  );
}

// Audit limit status bar shown to free users
function AuditStatusBar({ profile, onAudit }) {
  const { isKing, showPaywall } = useKing();
  if (isKing) return null;
  const today = new Date().toISOString().split("T")[0];
  const used = profile?.last_audit_date === today ? (profile?.audits_today || 0) : 0;
  const canAudit = used < 1;
  return (
    <div className={`audit-bar ${canAudit ? "audit-free" : "audit-used"}`}>
      <span style={{ fontSize: 18 }}>{canAudit ? "✅" : "⏰"}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {canAudit ? "Free Daily Audit Available" : "Daily Audit Used"}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
          {canAudit ? "1 free AI audit per day included" : "Resets tomorrow. Upgrade to KING for unlimited audits."}
        </div>
      </div>
      {canAudit
        ? <motion.button className="btn btn-primary btn-sm" onClick={onAudit} whileHover={{ scale: 1.02 }}>Run Audit →</motion.button>
        : <motion.button className="btn btn-sm btn-gold" onClick={showPaywall} whileHover={{ scale: 1.02 }}>👑 Unlock</motion.button>
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SMALL ATOMS (unchanged)
// ═══════════════════════════════════════════════════════════════════
function Spinner({ text }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:16,padding:"40px 0" }}>
      <div style={{ position:"relative" }}>
        <div className="spinner"/>
        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12 }}>✦</div>
      </div>
      {text && <div className="dot-pulse" style={{ display:"flex",alignItems:"center",gap:0 }}><span/><span/><span/></div>}
      {text && <p style={{ color:T.muted,fontSize:13 }}>{text}</p>}
    </div>
  );
}
function AIThinking({ label="AI is thinking…" }) {
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 18px",background:`${T.accent}12`,border:`1px solid ${T.accent}30`,borderRadius:12,marginBottom:8 }}>
      <div className="ai-thinking" style={{ fontSize:20 }}>🤖</div>
      <div><p style={{ fontSize:13,color:T.accent,fontWeight:600 }}>{label}</p><div className="dot-pulse"><span/><span/><span/></div></div>
    </motion.div>
  );
}
function ProgressBar({ step, total=7 }) {
  const pct = ((step-1)/(total-1))*100;
  return (
    <div style={{ width:"100%",maxWidth:500,marginBottom:4 }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
        <span style={{ fontSize:12,color:T.muted }}>Step {step} of {total}</span>
        <span style={{ fontSize:12,color:T.accent,fontWeight:600 }}>{Math.round(pct)}%</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width:`${pct}%` }}/></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AUTH SCREEN — Supabase-aware
// ═══════════════════════════════════════════════════════════════════
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false); const [err, setErr] = useState("");

  const submit = async () => {
    if (!email || !pass) return;
    setLoading(true); setErr("");
    if (supabase) {
      if (mode === "signup") {
        const { error } = await sbSignUp(email, pass, name || email.split("@")[0]);
        if (error) { setErr(error.message); setLoading(false); return; }
        const { data } = await supabase.auth.getSession();
        onAuth({ email, name: name || email.split("@")[0], isNew: true, sbUser: data.session?.user });
      } else {
        const { data, error } = await sbSignIn(email, pass);
        if (error) { setErr(error.message); setLoading(false); return; }
        onAuth({ email, name: data.user?.user_metadata?.full_name || email.split("@")[0], isNew: false, sbUser: data.user });
      }
    } else {
      // Dev mode — no Supabase configured
      onAuth({ email, name: name || email.split("@")[0], isNew: mode === "signup", sbUser: null });
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: "google" });
  };

  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:420 }}>
        <motion.div variants={fadeUp} style={{ textAlign:"center",marginBottom:28 }}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontSize:30,fontWeight:800,marginBottom:6 }}>Ai<span style={{ color:T.accent }}>sentials</span></div>
          <p style={{ color:T.muted }}>{mode==="signup" ? "Create your free account" : "Welcome back"}</p>
        </motion.div>
        <motion.div variants={fadeUp} className="glass-card" style={{ padding:28,display:"flex",flexDirection:"column",gap:18 }}>
          {err && <div style={{ background:`${T.red}18`,border:`1px solid ${T.red}40`,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.red }}>{err}</div>}
          <motion.button className="btn btn-ghost" style={{ width:"100%" }} whileHover={{ scale:1.01 }} onClick={handleGoogle}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </motion.button>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}><div className="divider" style={{ flex:1 }}/><span style={{ fontSize:12,color:T.muted }}>or</span><div className="divider" style={{ flex:1 }}/></div>
          {mode==="signup" && <div className="field"><label>Full Name</label><input className="input" placeholder="Your name" value={name} onChange={e=>setName(e.target.value)}/></div>}
          <div className="field"><label>Email</label><input className="input" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></div>
          <div className="field"><label>Password</label><input className="input" type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
          <motion.button className="btn btn-primary" style={{ width:"100%",marginTop:4 }} disabled={loading} whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }} onClick={submit}>
            {loading ? "…" : mode==="signup" ? "Create Account →" : "Sign In →"}
          </motion.button>
          <p style={{ textAlign:"center",fontSize:13,color:T.muted }}>
            {mode==="signup" ? "Already have an account? " : "New here? "}
            <span style={{ color:T.accent,cursor:"pointer",fontWeight:600 }} onClick={()=>setMode(m=>m==="signup"?"login":"signup")}>
              {mode==="signup" ? "Sign In" : "Sign Up"}
            </span>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ONBOARDING SCREEN (unchanged from original)
// ═══════════════════════════════════════════════════════════════════
function OnboardScreen({ user, onDone }) {
  const [country, setCountry] = useState(""); const [ig, setIg] = useState("");
  const countries = ["United States","United Kingdom","Canada","Australia","Pakistan","India","UAE","Germany","France","Singapore","Nigeria","Brazil","Mexico","South Africa","Philippines","Indonesia","Malaysia","Kenya","Saudi Arabia","Egypt"];
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:480 }}>
        <motion.div variants={fadeUp} style={{ marginBottom:32 }}>
          <ProgressBar step={1}/>
          <h2 style={{ fontSize:32,fontWeight:800,marginTop:20 }}>Hey {user.name?.split(" ")[0]} 👋</h2>
          <p style={{ color:T.muted,marginTop:6 }}>Let's personalize your AI-powered business.</p>
        </motion.div>
        <motion.div variants={fadeUp} className="glass-card" style={{ padding:28,display:"flex",flexDirection:"column",gap:20 }}>
          <div className="field">
            <label>Country / Region</label>
            <select className="input" value={country} onChange={e=>setCountry(e.target.value)}>
              <option value="">Select your country…</option>
              {countries.map(c=><option key={c}>{c}</option>)}
            </select>
            <p style={{ fontSize:11,color:T.muted,marginTop:4 }}>Used to localize suppliers, avoid tariffs & payment methods</p>
          </div>
          <div className="field">
            <label>Instagram Handle <span style={{ textTransform:"none",fontWeight:400 }}>(optional)</span></label>
            <input className="input" placeholder="@yourbrand" value={ig} onChange={e=>setIg(e.target.value)}/>
          </div>
          <motion.button className="btn btn-primary" style={{ width:"100%" }} whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }} onClick={()=>{ if(country) onDone({country,ig}); }}>
            Continue — Choose Niche →
          </motion.button>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NICHE SCREEN (unchanged)
// ═══════════════════════════════════════════════════════════════════
const NICHES = [
  {id:1,name:"AI-Powered Skincare",emoji:"✨",viral:95,diff:"Low",margin:"72%",desc:"Personalized routines via AI skin analysis. Fastest growing beauty segment 2026."},
  {id:2,name:"Micro-SaaS Tools",emoji:"⚡",viral:88,diff:"Medium",margin:"85%",desc:"One-problem software. No-code builders + AI = insane margins at scale."},
  {id:3,name:"Sustainable Fashion",emoji:"🌿",viral:91,diff:"Low",margin:"65%",desc:"Eco capsule wardrobes. Gen Z spending 40% more on sustainable brands."},
  {id:4,name:"AI Pet Products",emoji:"🐾",viral:93,diff:"Low",margin:"68%",desc:"Smart collars, health monitors, personalized nutrition. $300B market."},
  {id:5,name:"Digital Wellness Kits",emoji:"🧘",viral:86,diff:"Low",margin:"78%",desc:"Journaling, meditation tools, sleep optimization. Mental health = #1 spend 2026."},
  {id:6,name:"Home Automation",emoji:"🏠",viral:82,diff:"Medium",margin:"61%",desc:"Smart home starter kits. 1 in 3 homes going smart by 2026."},
  {id:7,name:"Creator Economy Tools",emoji:"🎥",viral:94,diff:"Medium",margin:"80%",desc:"Templates & scripts for content creators. 50M+ creators globally."},
  {id:8,name:"Functional Beverages",emoji:"🍵",viral:89,diff:"Low-Med",margin:"70%",desc:"Nootropics, mushroom coffee, adaptogen shots. Fastest food trend."},
  {id:9,name:"Kids EdTech",emoji:"📚",viral:84,diff:"Low",margin:"75%",desc:"AI-tutored learning kits, gamified STEM. Parents spending record amounts."},
  {id:10,name:"Wearable Tech Accessories",emoji:"⌚",viral:87,diff:"Medium",margin:"66%",desc:"Bands & cases for smartwatches/AR glasses. $100B+ market by 2027."},
];

function NicheScreen({ onSelect }) {
  const [sel, setSel] = useState(null);
  return (
    <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",padding:"48px 20px 80px",position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:920 }}>
        <motion.div variants={fadeUp} style={{ textAlign:"center",marginBottom:36 }}>
          <ProgressBar step={2}/>
          <div className="badge badge-gold" style={{ margin:"16px auto 16px",display:"inline-flex" }}>✦ AI-Curated for 2026</div>
          <h2 style={{ fontSize:"clamp(24px,4vw,38px)",fontWeight:800,marginBottom:8 }}>Choose Your Winning Niche</h2>
          <p style={{ color:T.muted }}>AI analyzed 10,000+ market signals. These are the highest-ROI plays right now.</p>
        </motion.div>
        <motion.div variants={stagger} style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }} className="grid-2">
          {NICHES.map(n=>(
            <motion.div key={n.id} variants={scaleIn} className={`niche-card ${sel?.id===n.id?"selected":""}`} onClick={()=>setSel(n)}>
              <div style={{ display:"flex",gap:12,marginBottom:10 }}>
                <span style={{ fontSize:28 }}>{n.emoji}</span>
                <div>
                  <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:15 }}>{n.name}</div>
                  <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginTop:5 }}>
                    <span className="badge badge-green">🔥 {n.viral}% viral</span>
                    <span className="badge badge-purple">💸 {n.margin}</span>
                    <span className="badge" style={{ background:T.border,color:T.muted }}>⚡ {n.diff}</span>
                  </div>
                </div>
              </div>
              <p style={{ fontSize:12,color:T.muted,lineHeight:1.55 }}>{n.desc}</p>
            </motion.div>
          ))}
        </motion.div>
        <AnimatePresence>{sel&&(
          <motion.div initial={{ opacity:0,y:16 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:8 }} style={{ textAlign:"center",marginTop:32 }}>
            <motion.button className="btn btn-primary" style={{ fontSize:16,padding:"15px 40px" }} whileHover={{ scale:1.03 }} whileTap={{ scale:.97 }} onClick={()=>onSelect(sel)}>
              Lock in {sel.name} →
            </motion.button>
          </motion.div>
        )}</AnimatePresence>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BRAND SCREEN (unchanged)
// ═══════════════════════════════════════════════════════════════════
function BrandScreen({ niche, onSelect }) {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(null);
  const generate = useCallback(async () => {
    setLoading(true); setSel(null);
    const res = await callClaude(`Generate 6 unique, premium brand names for a ${niche.name} business. Each 1-2 words, catchy, modern, memorable for 2026. Return JSON: {"brands":[{"name":"...","tagline":"...","rationale":"..."}]}`);
    setBrands(res?.brands||[{name:"LumiqCo",tagline:"Glow on your terms",rationale:"Modern, instantly recognizable"},{name:"AuraLab",tagline:"Science meets radiance",rationale:"Premium scientific credibility"},{name:"VivaSera",tagline:"Your skin's best chapter",rationale:"Aspirational, timeless sound"},{name:"NovaDerm",tagline:"Next-gen self care",rationale:"Future-forward positioning"},{name:"ZenVeil",tagline:"Calm, clear, radiant",rationale:"Wellness meets luxury"},{name:"ClearlyYou",tagline:"Skin that finally listens",rationale:"Personalization hook built-in"}]);
    setLoading(false);
  }, [niche]);
  useEffect(()=>{ generate(); },[]);
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 20px",position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:680 }}>
        <motion.div variants={fadeUp} style={{ marginBottom:28 }}>
          <ProgressBar step={3}/>
          <h2 style={{ fontSize:32,fontWeight:800,marginTop:16,marginBottom:6 }}>AI Brand Name Generator</h2>
          <p style={{ color:T.muted }}>Unique names for your <strong style={{ color:T.text }}>{niche.name}</strong> business.</p>
        </motion.div>
        {loading ? <AIThinking label="AI is crafting unique brand names…"/> : (
          <motion.div variants={stagger} style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {brands.map((b,i)=>(
              <motion.div key={i} variants={fadeUp} className={`brand-card ${sel?.name===b.name?"selected":""}`} onClick={()=>setSel(b)} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:16 }}>
                <div>
                  <div style={{ fontFamily:"Bricolage Grotesque",fontSize:22,fontWeight:800 }}>{b.name}</div>
                  <div style={{ fontSize:13,color:T.accent,fontStyle:"italic",marginTop:2 }}>"{b.tagline}"</div>
                  <div style={{ fontSize:12,color:T.muted,marginTop:3 }}>{b.rationale}</div>
                </div>
                <AnimatePresence>{sel?.name===b.name&&<motion.div initial={{ scale:0 }} animate={{ scale:1 }} style={{ color:T.accent,fontSize:22,flexShrink:0 }}>✓</motion.div>}</AnimatePresence>
              </motion.div>
            ))}
          </motion.div>
        )}
        <motion.div variants={fadeUp} style={{ display:"flex",gap:12,marginTop:24,flexWrap:"wrap" }}>
          <motion.button className="btn btn-ghost" onClick={generate} disabled={loading} whileHover={{ scale:1.02 }}>↻ Generate New Names</motion.button>
          <AnimatePresence>{sel&&<motion.button initial={{ opacity:0,x:16 }} animate={{ opacity:1,x:0 }} className="btn btn-primary" onClick={()=>onSelect(sel)} whileHover={{ scale:1.02 }}>Use "{sel.name}" →</motion.button>}</AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOGO SCREEN (unchanged)
// ═══════════════════════════════════════════════════════════════════
function LogoScreen({ brand, niche, onSelect }) {
  const [logos, setLogos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const generate = useCallback(async (isRegen=false) => {
    if(isRegen) setRegenerating(true); else setLoading(true);
    setSel(null);
    await new Promise(r=>setTimeout(r,1800));
    setLogos(generateAllLogos(brand.name, niche.name));
    if(isRegen) setRegenerating(false); else setLoading(false);
  },[brand.name,niche.name]);
  useEffect(()=>{ generate(); },[]);
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 20px",position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:800 }}>
        <motion.div variants={fadeUp} style={{ marginBottom:28 }}>
          <ProgressBar step={4}/>
          <h2 style={{ fontSize:32,fontWeight:800,marginTop:16,marginBottom:6 }}>Your AI-Generated Logos</h2>
          <p style={{ color:T.muted }}>4 unique concepts for <strong style={{ color:T.text }}>{brand.name}</strong>. Generated exclusively for you.</p>
        </motion.div>
        {loading ? (
          <div style={{ textAlign:"center" }}>
            <AIThinking label="Generating 4 unique logo concepts…"/>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:20 }} className="grid-2">
              {[0,1,2,3].map(i=><div key={i} className="skeleton" style={{ height:180,borderRadius:18 }}/>)}
            </div>
          </div>
        ) : (
          <>
            {regenerating && <AIThinking label="Regenerating fresh logo concepts…"/>}
            <motion.div variants={stagger} style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }} className="grid-2">
              {logos.map(logo=>(
                <motion.div key={logo.id} variants={scaleIn} className={`logo-card ${sel?.id===logo.id?"selected":""}`} onClick={()=>setSel(logo)}>
                  <div style={{ borderRadius:12,overflow:"hidden",marginBottom:14,border:`1px solid ${logo.accent}30` }}>
                    <img src={svgToDataUrl(logo.svg)} alt={logo.label} style={{ width:"100%",height:"auto",display:"block" }}/>
                  </div>
                  <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:15,marginBottom:3 }}>{logo.label}</div>
                  <div style={{ fontSize:12,color:T.muted }}>{logo.desc}</div>
                  <div style={{ display:"flex",gap:8,marginTop:10 }}>
                    <div style={{ width:14,height:14,borderRadius:"50%",background:logo.accent,boxShadow:`0 0 8px ${logo.accent}` }}/>
                    <span style={{ fontSize:11,color:T.muted }}>Unique to your brand</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
            <motion.div variants={fadeUp} style={{ display:"flex",gap:12,marginTop:28,flexWrap:"wrap" }}>
              <motion.button className="btn btn-ghost" onClick={()=>generate(true)} disabled={regenerating} whileHover={{ scale:1.02 }}>↻ Regenerate Logos</motion.button>
              <AnimatePresence>{sel&&<motion.button initial={{ opacity:0,x:16 }} animate={{ opacity:1,x:0 }} className="btn btn-primary" onClick={()=>onSelect(sel)} whileHover={{ scale:1.02 }}>Select {sel.label} →</motion.button>}</AnimatePresence>
            </motion.div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// WEBSITE SCREEN (unchanged)
// ═══════════════════════════════════════════════════════════════════
function WebsiteScreen({ brand, niche, logo, onDone }) {
  const [prompt, setPrompt] = useState(""); const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(()=>{
    (async()=>{
      const r = await callClaude(`Create a detailed Lovable.dev website prompt for a ${niche.name} brand called "${brand.name}" (tagline: "${brand.tagline}"). Premium conversion-optimized ecommerce landing page. Dark luxury design, purple accent, mobile-first. Return JSON: {"prompt":"..."}`);
      setPrompt(r?.prompt||`Build a premium ${niche.name} brand website for "${brand.name}" — "${brand.tagline}". Dark luxury landing page with purple (#7c5cfc) accents. Hero with CTA, product grid, testimonials, pricing, FAQ, sticky header. Mobile-first, fast-loading, conversion-optimized.`);
      setLoading(false);
    })();
  },[]);
  const copy = ()=>{ navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(()=>setCopied(false),2200); };
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"48px 20px",position:"relative",zIndex:1 }}>
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ width:"100%",maxWidth:680 }}>
        <motion.div variants={fadeUp} style={{ marginBottom:28 }}>
          <ProgressBar step={5}/>
          <h2 style={{ fontSize:32,fontWeight:800,marginTop:16,marginBottom:6 }}>Your Website Prompt</h2>
          <p style={{ color:T.muted }}>Paste this into Lovable.dev to generate your complete website.</p>
        </motion.div>
        {loading ? <AIThinking label="AI is crafting your website blueprint…"/> : (
          <>
            <motion.div variants={fadeUp} style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:16 }}>
              <a href="https://lovable.dev" target="_blank" rel="noreferrer" className="btn btn-gold">Open Lovable.dev ↗</a>
              <motion.button className="btn btn-primary" onClick={copy} whileHover={{ scale:1.02 }}>{copied?"✓ Copied!":"Copy Prompt"}</motion.button>
            </motion.div>
            <motion.div variants={fadeUp} className="glass-card" style={{ padding:20,marginBottom:20 }}>
              <div style={{ fontSize:11,color:T.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10 }}>AI Website Prompt</div>
              <pre style={{ fontSize:12.5,color:T.muted,whiteSpace:"pre-wrap",lineHeight:1.7,maxHeight:220,overflowY:"auto" }}>{prompt}</pre>
            </motion.div>
            <motion.div variants={stagger} style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:24 }}>
              {[["1","Open Lovable.dev"],["2","Paste the prompt"],["3","Click Generate"],["4","Publish your site"],["5","Enter URL below to unlock dashboard"]].map(([n,t])=>(
                <motion.div key={n} variants={fadeUp} style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ width:26,height:26,borderRadius:"50%",background:`${T.accent}25`,border:`1px solid ${T.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:T.accent,flexShrink:0 }}>{n}</div>
                  <span style={{ fontSize:14,color:T.text }}>{t}</span>
                </motion.div>
              ))}
            </motion.div>
            <motion.div variants={fadeUp} className="field" style={{ marginBottom:12 }}>
              <label>Your Website URL</label>
              <div style={{ display:"flex",gap:10 }}>
                <input className="input" placeholder="https://yourbrand.lovable.app" value={url} onChange={e=>setUrl(e.target.value)}/>
                <motion.button className="btn btn-primary" onClick={()=>{ if(url) onDone(url); }} whileHover={{ scale:1.02 }} style={{ flexShrink:0 }}>Unlock →</motion.button>
              </div>
            </motion.div>
            <button className="btn btn-ghost btn-sm" onClick={()=>onDone("")} style={{ color:T.muted }}>Skip for now →</button>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
const NAV = [
  { id:"overview",   icon:"⊞",  label:"Overview",          king:false },
  { id:"pricing",    icon:"💰",  label:"Pricing Strategy",  king:false },
  { id:"suppliers",  icon:"🔗",  label:"Supplier Finder",   king:false },
  { id:"revenue",    icon:"📈",  label:"Revenue Tracker",   king:false },
  { id:"calendar",   icon:"📅",  label:"Content Calendar",  king:false },
  { id:"ads",        icon:"🎯",  label:"Ads Strategy",      king:true  },
  { id:"influencers",icon:"🌟",  label:"Influencer Hub",    king:true  },
  { id:"tools",      icon:"⚡",  label:"Revenue Tools",     king:true  },
  { id:"growth",     icon:"🚀",  label:"Growth & Followers",king:true  },
  { id:"payment",    icon:"💳",  label:"Payment Setup",     king:false },
  { id:"motivation", icon:"🔥",  label:"Motivation",        king:false },
];

const QUOTES = ["Consistency creates winners.","Revenue going down today doesn't mean failure. Keep going.","Every empire started with a single step. You've already taken it.","AI builds the machine. You collect the profits.","Small actions today create massive results tomorrow.","Your business runs while you sleep. That's the power of AI.","Focus on progress, not perfection.","The person who shows up every day beats talent every time."];

function genRevData() { return ["M","T","W","T","F","S","S"].map(d=>({d,v:Math.floor(Math.random()*300)+40})); }
function genCalendar(niche) {
  const hooks=["POV: You found the secret to","Nobody talks about this but","This changed everything for my","Stop sleeping on this","The $0 strategy that got me 10K views","I tested this for 30 days and"];
  const platforms=["Instagram Reels","TikTok","YouTube Shorts","Instagram Story","LinkedIn"];
  const times=["9:00 AM","12:00 PM","6:00 PM","7:30 PM","8:00 PM"];
  const types=["Product Showcase","Tutorial","Behind Scenes","Testimonial","Trend Hijack"];
  return Array.from({length:50},(_,i)=>{
    const rng=seededRng(`cal-${niche?.name||""}-${i}`);
    return { day:i+1, hook:pick(hooks,rng)+" "+(niche?.name||"your niche"), caption:`Day ${i+1}: ${pick(["Elevate","Transform","Discover","Unlock","Master"],rng)} your ${niche?.name||"brand"} game. Drop a 🔥`, hashtags:["#business2026","#aitools","#entrepreneur","#sidehustle","#growth"], platform:pick(platforms,rng), time:pick(times,rng), type:pick(types,rng), videoPrompt:`Fast-cut ${pick(types,rng)} video for ${niche?.name||"your product"}. Hook in 2 seconds, trending audio, strong CTA.`, completed:false };
  });
}

function Dashboard({ user, profile: initProfile, niche, brand, logo, website, sbUser }) {
  const { isKing, profile, showPaywall } = useKing();
  const [nav, setNav] = useState("overview");
  const [sideOpen, setSideOpen] = useState(false);
  const [revData, setRevData] = useState(genRevData);
  const [calendar, setCalendar] = useState(()=>genCalendar(niche));
  const [openDay, setOpenDay] = useState(null);
  const [todayRev, setTodayRev] = useState(""); const [revMsg, setRevMsg] = useState("");
  const [pricing, setPricing] = useState(null); const [suppliers, setSuppliers] = useState(null);
  const [ads, setAds] = useState(null); const [inf, setInf] = useState(null);
  const [deadLeads, setDeadLeads] = useState(null); const [sdrScript, setSdrScript] = useState(null);
  const [aiLoading, setAiLoading] = useState("");
  const maxRev = Math.max(...revData.map(d=>d.v),1);
  const quote = QUOTES[Math.floor(seededRng(`${brand.name}-q`)() * QUOTES.length)];
  const activeProfile = profile || initProfile;

  const loadData = useCallback(async (type) => {
    if(type==="pricing"&&!pricing){setAiLoading("pricing");const r=await callClaude(`Pricing strategy for ${brand.name} selling ${niche.name}. Return JSON: {"price":"$29.99","cost":"$9","margin":"67%","positioning":"Premium Affordable","tips":["...","...","..."],"upsells":["...","..."]}`);setPricing(r||{price:"$29.99",cost:"$9",margin:"67%",positioning:"Premium Affordable",tips:["$29.99 beats $30 by 24% psychologically","3-pack at $79 increases AOV by 180%","Free shipping threshold boosts cart value"],upsells:["3-pack bundle at $69","Monthly subscription -15%"]});setAiLoading("");}
    if(type==="suppliers"&&!suppliers){setAiLoading("suppliers");const r=await callClaude(`Suppliers for ${niche.name} in ${activeProfile?.country||"your region"}. Return JSON: {"suppliers":[{"name":"...","location":"...","deliveryDays":"3-5","costRange":"$5-$15","quality":"High","tip":"..."}],"negotiationTip":"..."}`);setSuppliers(r||{suppliers:[{name:"AlphaSource Co.",location:activeProfile?.country||"Regional",deliveryDays:"3-5",costRange:"$6-$14",quality:"High",tip:"Order MOQ 50+ for 15% discount"}],negotiationTip:"Email 3+ suppliers simultaneously. Use competing quotes to negotiate 15-25% below first offer."});setAiLoading("");}
    if(type==="ads"&&!ads){setAiLoading("ads");const r=await callClaude(`Meta + TikTok ads for ${brand.name} in ${niche.name}. Return JSON: {"meta":{"budget":"$5/day","audience":"...","objective":"...","creative":"..."},"tiktok":{"budget":"$5/day","audience":"...","objective":"...","creative":"..."},"scaling":["...","...","..."]}`);setAds(r||{meta:{budget:"$5/day",audience:"Ages 22-38, interest in "+niche.name,objective:"Conversions",creative:"Before/after UGC 15-30 sec"},tiktok:{budget:"$5/day",audience:"Broad 18-35, TopView",objective:"Website clicks",creative:"Trending audio, product reveal"},scaling:["Day 1-3: $5/day test, goal ROAS 1.5x","Day 4-7: Double budget on winner","Week 2: Duplicate, test 2 new creatives"]});setAiLoading("");}
    if(type==="influencers"&&!inf){setAiLoading("influencers");const r=await callClaude(`Influencer strategy for ${brand.name} in ${niche.name}. Return JSON: {"tiers":[{"tier":"Nano 1K-10K","cost":"$50-200","roi":"Very High","bestFor":"Authenticity"},{"tier":"Micro 10K-100K","cost":"$200-1000","roi":"High","bestFor":"Engagement"},{"tier":"Macro 100K+","cost":"$1000+","roi":"Medium","bestFor":"Reach"}],"dmScript":"...","tips":["...","..."]}`);setInf(r||{tiers:[{tier:"Nano 1K-10K",cost:"$50-200",roi:"Very High",bestFor:"Authenticity & trust"},{tier:"Micro 10K-100K",cost:"$200-1000",roi:"High",bestFor:"Engaged niche audience"},{tier:"Macro 100K+",cost:"$1000+",roi:"Medium",bestFor:"Mass awareness"}],dmScript:`Hey! I'm the founder of ${brand.name}. Your content is exactly our vibe. Open to a collab? Free product + commission. Zero pressure 🙏`,tips:["Offer 10-15% commission affiliate deal","Get performance stats before paying"]});setAiLoading("");}
    if(type==="deadleads"&&!deadLeads){setAiLoading("deadleads");const r=await callClaude(`Dead lead reactivation for ${brand.name} selling ${niche.name}. Return JSON: {"emailSubject":"...","emailBody":"...","smsScript":"..."}`);setDeadLeads(r||{emailSubject:`[${brand.name}] We haven't forgotten you 👋`,emailBody:`Hey,\n\nYou visited ${brand.name} and didn't complete your order.\n\nWe're offering you a private 15% discount.\n\nUse code: COMEBACK15 (valid 48hrs)\n\n→ [LINK]\n\n${brand.name} Team`,smsScript:`Hey! ${brand.name} here 👋 You left something behind. Grab 15% off with COMEBACK15 — expires 48h: [LINK]`});setAiLoading("");}
    if(type==="sdr"&&!sdrScript){setAiLoading("sdr");const r=await callClaude(`AI SDR chatbot scripts for ${brand.name} handling Instagram + WhatsApp for ${niche.name}. Return JSON: {"welcome":"...","faqs":[{"q":"...","a":"..."},{"q":"...","a":"..."},{"q":"...","a":"..."}],"closing":"..."}`);setSdrScript(r||{welcome:`👋 Welcome to ${brand.name}! I can help with orders, pricing, and questions. What can I help you with?`,faqs:[{q:"How long is shipping?",a:"Ships within 24hrs. Delivery 3-5 days with tracking."},{q:"Return policy?",a:"30-day no-questions-asked returns. Prepaid label included."},{q:"Any bundles?",a:"Yes! 3-pack at $69 (saves 23%). Reply 'bundle' to see it."}],closing:`Ready to order? Visit ${brand.name} or reply 'BUY' for checkout link 💪`});setAiLoading("");}
  },[pricing,suppliers,ads,inf,deadLeads,sdrScript,brand,niche,activeProfile]);

  useEffect(()=>{
    if(nav==="pricing") loadData("pricing");
    if(nav==="suppliers") loadData("suppliers");
    if(nav==="ads") loadData("ads");
    if(nav==="influencers") loadData("influencers");
  },[nav]);

  const handleAudit = async () => {
    if (!sbUser) { alert("Sign in to use audits"); return; }
    const result = await sbTryRunAudit(sbUser.id, isKing);
    if (!result.allowed) showPaywall();
  };

  const submitRev = ()=>{
    const v=parseFloat(todayRev); if(isNaN(v)) return;
    const yest=revData[revData.length-1]?.v||0;
    const diff=yest?Math.abs(((v-yest)/yest)*100).toFixed(0):0;
    const msg=v>yest?`🚀 You made ${diff}% more than yesterday. Excellent growth!`:v<yest?`💪 You made ${diff}% less than yesterday. Don't worry — you still earned. Keep going!`:`🎯 Same as yesterday. Consistency is your superpower!`;
    setRevMsg(msg); setRevData(prev=>[...prev.slice(1),{d:"T",v}]); setTodayRev("");
  };

  const content = generateUniqueResponse(brand.name, niche.name, nav);

  const navClick = (item) => {
    if (item.king && !isKing) { showPaywall(); return; }
    setNav(item.id); setSideOpen(false);
  };

  // ── SECTIONS ─────────────────────────────────────────────────────
  const sections = {
    overview: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:24 }}>
        <motion.div variants={fadeUp} style={{ background:`linear-gradient(135deg,${T.accent}18,transparent)`,border:`1px solid ${T.accent}30`,borderRadius:16,padding:"18px 22px" }}>
          <div style={{ fontSize:11,color:T.accent,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",marginBottom:6 }}>Daily Motivation</div>
          <p style={{ fontFamily:"Bricolage Grotesque",fontSize:18,fontStyle:"italic",color:T.text,fontWeight:500 }}>"{quote}"</p>
        </motion.div>

        {!isKing && <AuditStatusBar profile={activeProfile} onAudit={handleAudit}/>}

        <motion.div variants={stagger} style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14 }} className="grid-4">
          {[[brand.name,"Brand Name",brand.tagline,T.accent],[niche.name,"Niche",`${niche.margin} margin`,T.green],[logo?.label||"Custom","Logo Style","Premium design",T.gold],[website?"Live ✓":"Pending","Website",website||"Add URL",""]].map(([v,l,sub,c],i)=>(
            <motion.div key={l} variants={scaleIn} className="stat-card">
              <div style={{ fontSize:11,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6 }}>{l}</div>
              <div style={{ fontFamily:"Bricolage Grotesque",fontSize:17,fontWeight:700,color:c||T.text,marginBottom:4 }}>{v}</div>
              <div style={{ fontSize:11,color:T.muted }}>{sub}</div>
            </motion.div>
          ))}
        </motion.div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }} className="grid-2">
          <motion.div variants={fadeUp} className="solid-card" style={{ padding:24 }}>
            <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:20 }}>Logo Preview</div>
            <div style={{ display:"flex",justifyContent:"center",marginBottom:16 }}>
              {logo?.svg
                ? <img src={svgToDataUrl(logo.svg)} alt="logo" style={{ width:"100%",maxWidth:280,height:"auto",borderRadius:12 }}/>
                : <div style={{ width:120,height:120,borderRadius:20,background:`linear-gradient(135deg,${T.accent},${T.accentB})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,fontFamily:"Bricolage Grotesque",fontWeight:800,color:"#fff" }}>{brand.name[0]}</div>
              }
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"Bricolage Grotesque",fontSize:18,fontWeight:800 }}>{brand.name}</div>
              <div style={{ fontSize:13,color:T.muted,fontStyle:"italic",marginTop:2 }}>{brand.tagline}</div>
              <div style={{ display:"flex",gap:8,justifyContent:"center",marginTop:12 }}>
                {logo?.svg&&<motion.button className="btn btn-ghost btn-sm" whileHover={{ scale:1.02 }} onClick={()=>downloadSVG(logo.svg,brand.name)}>↓ SVG</motion.button>}
                {logo?.svg&&<motion.button className="btn btn-ghost btn-sm" whileHover={{ scale:1.02 }} onClick={()=>downloadPNG(logo.svg,brand.name)}>↓ PNG</motion.button>}
              </div>
            </div>
          </motion.div>
          <motion.div variants={fadeUp} className="solid-card" style={{ padding:24 }}>
            <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:16 }}>Business Details</div>
            {[["Owner",user.name],["Country",activeProfile?.country||"—"],["Instagram",activeProfile?.ig||"Not set"],["Niche",niche.name],["Margin Est.",niche.margin],["Website",website||"Not set"],["Membership",isKing?"👑 KING":"Free"]].map(([k,v])=>(
              <div key={k} style={{ display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontSize:13,color:T.muted }}>{k}</span>
                <span style={{ fontSize:13,fontWeight:500,color:k==="Membership"&&isKing?T.gold:T.text,maxWidth:"60%",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{v}</span>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div variants={fadeUp} className="solid-card" style={{ padding:24 }}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:6,fontSize:15 }}>🤖 AI Insight for {brand.name}</div>
          <p style={{ fontSize:14,color:T.muted,lineHeight:1.7 }}>
            <strong style={{ color:T.text }}>{content.opener}</strong> {content.action}.
            Target: <span className="badge badge-green">{content.metric}</span>
          </p>
          <p style={{ fontSize:13,color:T.muted,marginTop:10,lineHeight:1.6 }}>→ <em>{content.next}</em></p>
        </motion.div>
      </motion.div>
    ),

    pricing: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>AI Pricing Strategy</div>
          <p style={{ color:T.muted,fontSize:14 }}>Psychologically optimized for maximum conversions</p>
        </motion.div>
        {!isKing&&<AuditStatusBar profile={activeProfile} onAudit={handleAudit}/>}
        {aiLoading==="pricing"?<AIThinking label="Calculating optimal pricing…"/>:pricing?(
          <>
            <motion.div variants={stagger} style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14 }} className="grid-4">
              {[["Selling Price",pricing.price,T.accent],["Product Cost",pricing.cost,T.muted],["Profit Margin",pricing.margin,T.green],["Positioning",pricing.positioning,T.gold]].map(([l,v,c])=>(
                <motion.div key={l} variants={scaleIn} className="stat-card"><div style={{ fontSize:11,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8 }}>{l}</div><div style={{ fontFamily:"Bricolage Grotesque",fontSize:22,fontWeight:800,color:c }}>{v}</div></motion.div>
              ))}
            </motion.div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }} className="grid-2">
              <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:14,color:T.accent }}>💡 Pricing Psychology Tips</div>
                {(pricing.tips||[]).map((t,i)=><div key={i} style={{ display:"flex",gap:10,marginBottom:12 }}><span style={{ color:T.accent }}>→</span><span style={{ fontSize:13.5,color:T.text,lineHeight:1.55 }}>{t}</span></div>)}
              </motion.div>
              <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:14,color:T.gold }}>📦 Upsells & Bundles</div>
                {(pricing.upsells||[]).map((u,i)=><div key={i} style={{ background:`${T.gold}12`,border:`1px solid ${T.gold}25`,borderRadius:10,padding:"12px 14px",marginBottom:10,fontSize:13.5,color:T.text }}>{u}</div>)}
              </motion.div>
            </div>
          </>
        ):<Spinner/>}
      </motion.div>
    ),

    suppliers: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Local Supplier Finder</div><p style={{ color:T.muted,fontSize:14 }}>AI-selected for {activeProfile?.country} — fastest delivery, no tariff issues</p></motion.div>
        {aiLoading==="suppliers"?<AIThinking label="Finding your best local suppliers…"/>:suppliers?(
          <>
            {(suppliers.suppliers||[]).map((s,i)=>(
              <motion.div key={i} variants={fadeUp} className="solid-card" style={{ padding:22,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap" }}>
                <div style={{ flex:1,minWidth:200 }}>
                  <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:17,marginBottom:4 }}>{s.name}</div>
                  <div style={{ fontSize:12,color:T.muted,marginBottom:10 }}>📍 {s.location}</div>
                  <div style={{ fontSize:13,background:`${T.accent}12`,border:`1px solid ${T.accent}25`,borderRadius:8,padding:"8px 12px",color:T.text }}>💡 {s.tip}</div>
                </div>
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",flexShrink:0 }}>
                  <span className="badge badge-green">🚀 {s.deliveryDays} days</span>
                  <span className="badge badge-purple">💵 {s.costRange}</span>
                  <span className="badge badge-gold">⭐ {s.quality}</span>
                </div>
              </motion.div>
            ))}
            {suppliers.negotiationTip&&<motion.div variants={fadeUp} style={{ background:`${T.green}10`,border:`1px solid ${T.green}30`,borderRadius:14,padding:"18px 22px" }}><div style={{ fontSize:11,color:T.green,fontWeight:700,textTransform:"uppercase",marginBottom:6 }}>Negotiation Tip</div><p style={{ fontSize:14,color:T.text,lineHeight:1.6 }}>{suppliers.negotiationTip}</p></motion.div>}
          </>
        ):<Spinner/>}
      </motion.div>
    ),

    revenue: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Revenue Tracker</div><p style={{ color:T.muted,fontSize:14 }}>Log daily revenue and get AI motivational feedback</p></motion.div>
        {!isKing&&<AuditStatusBar profile={activeProfile} onAudit={handleAudit}/>}
        <motion.div variants={fadeUp} className="solid-card" style={{ padding:24 }}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:20 }}>Weekly Revenue</div>
          <div style={{ display:"flex",alignItems:"flex-end",gap:6,height:140 }}>
            {revData.map((d,i)=>(
              <div key={i} className="bar-wrap">
                <motion.div className="bar" initial={{ height:0 }} animate={{ height:`${(d.v/maxRev)*100}%` }} transition={{ delay:i*.06,duration:.6,ease:[.16,1,.3,1] }}
                  style={{ width:"100%",minHeight:4,background:i===revData.length-1?`linear-gradient(180deg,${T.accent},${T.accentB})`:T.border,boxShadow:i===revData.length-1?`0 0 16px ${T.accent}60`:"none" }}/>
                <div style={{ fontSize:11,color:T.muted }}>{d.d}</div>
                <div style={{ fontSize:10,color:T.muted }}>${d.v}</div>
              </div>
            ))}
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="solid-card" style={{ padding:22,display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap" }}>
          <div className="field" style={{ flex:1,minWidth:180 }}>
            <label>Today's Revenue ($)</label>
            <input className="input" type="number" placeholder="e.g. 150" value={todayRev} onChange={e=>setTodayRev(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submitRev()}/>
          </div>
          <motion.button className="btn btn-primary" onClick={submitRev} whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}>Log Revenue →</motion.button>
        </motion.div>
        <AnimatePresence>{revMsg&&<motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} style={{ background:`${T.accent}12`,border:`1px solid ${T.accent}35`,borderRadius:14,padding:"18px 22px",display:"flex",gap:12,alignItems:"flex-start" }}><span style={{ fontSize:22 }}>🤖</span><p style={{ fontSize:15,color:T.text,lineHeight:1.6 }}>{revMsg}</p></motion.div>}</AnimatePresence>
      </motion.div>
    ),

    calendar: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
          <div><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>50-Day Content Calendar</div><p style={{ color:T.muted,fontSize:14 }}>Click any day to view hook, caption, video prompt & more</p></div>
          <motion.button className="btn btn-ghost btn-sm" onClick={()=>{ setCalendar(genCalendar(niche)); setOpenDay(null); }} whileHover={{ scale:1.02 }}>↻ Refresh 50 Days</motion.button>
        </motion.div>
        <motion.div variants={fadeUp} style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:7 }} className="cal-grid">
          {calendar.slice(0,49).map(day=>(
            <motion.div key={day.day} className={`cal-cell ${day.completed?"done":""} ${openDay?.day===day.day?"open":""}`} onClick={()=>setOpenDay(openDay?.day===day.day?null:day)} whileHover={{ scale:1.04 }}>
              <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:13,marginBottom:3 }}>D{day.day}</div>
              <div style={{ fontSize:9,color:T.muted,lineHeight:1.3 }}>{day.platform.split(" ")[0]}</div>
              <div style={{ fontSize:9,color:T.accent,marginTop:3 }}>{day.time}</div>
            </motion.div>
          ))}
        </motion.div>
        <AnimatePresence>{openDay&&(
          <motion.div key={openDay.day} initial={{ opacity:0,y:20 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:10 }} className="solid-card" style={{ padding:24 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:10 }}>
              <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:800,fontSize:20 }}>Day {openDay.day} — {openDay.type}</div>
              <div style={{ display:"flex",gap:8 }}><span className="badge badge-purple">{openDay.platform}</span><span className="badge badge-green">{openDay.time}</span></div>
            </div>
            {[["🎣 Viral Hook",openDay.hook],["✍️ Caption",openDay.caption],["🎬 Video Prompt",openDay.videoPrompt]].map(([title,content])=>(
              <div key={title} style={{ marginBottom:16 }}>
                <div style={{ fontSize:11,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6 }}>{title}</div>
                <div style={{ background:T.surface,borderRadius:10,padding:"12px 16px",fontSize:14,color:T.text,lineHeight:1.6 }}>{content}</div>
              </div>
            ))}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11,color:T.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8 }}>#️⃣ Hashtags</div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>{openDay.hashtags.map(h=><span key={h} className="badge badge-purple">{h}</span>)}</div>
            </div>
            <div style={{ display:"flex",gap:10 }}>
              <motion.button className="btn btn-primary btn-sm" whileHover={{ scale:1.02 }} onClick={()=>{ setCalendar(c=>c.map(d=>d.day===openDay.day?{...d,completed:true}:d)); setOpenDay(null); }}>✓ Mark Completed</motion.button>
              <motion.button className="btn btn-ghost btn-sm" whileHover={{ scale:1.02 }}>🔔 Remind Me</motion.button>
            </div>
          </motion.div>
        )}</AnimatePresence>
      </motion.div>
    ),

    ads: (
      <LockedFeature label="Ads Strategy — KING Feature">
        <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
          <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Ads Strategy</div><p style={{ color:T.muted,fontSize:14 }}>Meta + TikTok campaigns built by AI for {brand.name}</p></motion.div>
          {aiLoading==="ads"?<AIThinking label="Building your ad campaigns…"/>:ads?(
            <>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }} className="grid-2">
                {[["Meta (Facebook/Instagram)",ads.meta,"#1877f2"],["TikTok Ads",ads.tiktok,"#ff0050"]].map(([name,plan,color])=>(
                  <motion.div key={name} variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:16 }}>
                      <div style={{ width:8,height:8,borderRadius:"50%",background:color,boxShadow:`0 0 10px ${color}` }}/>
                      <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700 }}>{name}</div>
                    </div>
                    {plan&&Object.entries(plan).map(([k,v])=>(
                      <div key={k} style={{ padding:"8px 0",borderBottom:`1px solid ${T.border}` }}>
                        <div style={{ fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:2 }}>{k}</div>
                        <div style={{ fontSize:13,color:T.text }}>{v}</div>
                      </div>
                    ))}
                  </motion.div>
                ))}
              </div>
              <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:16 }}>📈 Scaling Roadmap</div>
                {(ads.scaling||[]).map((s,i)=>(
                  <div key={i} style={{ display:"flex",gap:14,marginBottom:14 }}>
                    <div style={{ width:28,height:28,borderRadius:"50%",background:T.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:14,color:T.text,lineHeight:1.55,paddingTop:4 }}>{s}</div>
                  </div>
                ))}
              </motion.div>
            </>
          ):<Spinner/>}
        </motion.div>
      </LockedFeature>
    ),

    influencers: (
      <LockedFeature label="Influencer Hub — KING Feature">
        <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
          <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Influencer Marketing Hub</div><p style={{ color:T.muted,fontSize:14 }}>Right creators, right price, maximum ROI</p></motion.div>
          {aiLoading==="influencers"?<AIThinking label="Mapping your influencer strategy…"/>:inf?(
            <>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14 }} className="grid-3">
                {(inf.tiers||[]).map((t,i)=>(
                  <motion.div key={i} variants={scaleIn} className="solid-card" style={{ padding:22,textAlign:"center" }}>
                    <div style={{ fontSize:28,marginBottom:10 }}>{"⭐".repeat(i+1)}</div>
                    <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:6 }}>{t.tier}</div>
                    <div style={{ fontFamily:"Bricolage Grotesque",fontSize:20,fontWeight:800,color:T.accent,marginBottom:8 }}>{t.cost}</div>
                    <span className="badge badge-green">{t.roi} ROI</span>
                    <p style={{ fontSize:12,color:T.muted,marginTop:10 }}>Best for: {t.bestFor}</p>
                  </motion.div>
                ))}
              </div>
              <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:10,color:T.accent }}>📩 DM Script</div>
                <div style={{ background:T.surface,borderRadius:10,padding:16,fontSize:14,color:T.text,lineHeight:1.7,fontStyle:"italic" }}>"{inf.dmScript}"</div>
              </motion.div>
              <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,marginBottom:14 }}>🤝 Negotiation Playbook</div>
                {(inf.tips||[]).map((t,i)=><div key={i} style={{ display:"flex",gap:10,marginBottom:10 }}><span style={{ color:T.green }}>✓</span><span style={{ fontSize:14,color:T.text }}>{t}</span></div>)}
              </motion.div>
            </>
          ):<Spinner/>}
        </motion.div>
      </LockedFeature>
    ),

    tools: (
      <LockedFeature label="Instant Revenue Tools — KING Feature">
        <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
          <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Instant Revenue Tools</div><p style={{ color:T.muted,fontSize:14 }}>Recover dead leads and automate sales 24/7</p></motion.div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }} className="grid-2">
            <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
              <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:17,marginBottom:8 }}>💀→💰 Dead Lead Reactivator</div>
              <p style={{ fontSize:13,color:T.muted,marginBottom:16 }}>Turn cold leads into paying customers with AI-crafted scripts.</p>
              {!deadLeads?<motion.button className="btn btn-primary btn-sm" onClick={()=>loadData("deadleads")} whileHover={{ scale:1.02 }}>Generate Scripts →</motion.button>
                :aiLoading==="deadleads"?<AIThinking label="Writing your scripts…"/>
                :<div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                  <div><div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:4,textTransform:"uppercase" }}>Email Subject</div><div style={{ background:T.surface,borderRadius:8,padding:"10px 14px",fontSize:13 }}>{deadLeads.emailSubject}</div></div>
                  <div><div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:4,textTransform:"uppercase" }}>Email Body</div><div style={{ background:T.surface,borderRadius:8,padding:"10px 14px",fontSize:12,color:T.text,lineHeight:1.6,maxHeight:130,overflowY:"auto" }}>{deadLeads.emailBody}</div></div>
                  <div><div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:4,textTransform:"uppercase" }}>SMS Script</div><div style={{ background:T.surface,borderRadius:8,padding:"10px 14px",fontSize:13 }}>{deadLeads.smsScript}</div></div>
                </div>
              }
            </motion.div>
            <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
              <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:17,marginBottom:8 }}>🤖 AI-SDR (24/7 Sales Agent)</div>
              <p style={{ fontSize:13,color:T.muted,marginBottom:16 }}>Chatbot scripts for Instagram, WhatsApp & website.</p>
              {!sdrScript?<motion.button className="btn btn-primary btn-sm" onClick={()=>loadData("sdr")} whileHover={{ scale:1.02 }}>Build Sales Agent →</motion.button>
                :aiLoading==="sdr"?<AIThinking label="Building your AI sales agent…"/>
                :<div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                  <div><div style={{ fontSize:11,color:T.muted,fontWeight:700,marginBottom:4,textTransform:"uppercase" }}>Welcome Message</div><div style={{ background:T.surface,borderRadius:8,padding:"10px 14px",fontSize:13 }}>{sdrScript.welcome}</div></div>
                  {(sdrScript.faqs||[]).map((faq,i)=><div key={i} style={{ background:T.surface,borderRadius:8,padding:"10px 14px" }}><div style={{ fontSize:12,color:T.accent,fontWeight:600,marginBottom:3 }}>Q: {faq.q}</div><div style={{ fontSize:12,color:T.text }}>A: {faq.a}</div></div>)}
                </div>
              }
            </motion.div>
          </div>
          <motion.div variants={fadeUp} className="solid-card" style={{ padding:22 }}>
            <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:17,marginBottom:14 }}>📡 Viral Trend Radar</div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10 }}>
              {["AI + product demo going viral","Unboxing challenge trend ↑","Before/after testimonial format","'Day in my life' POV content","Duet & stitch collaborations","Comment-bait controversial takes","Founder story — raw & unfiltered","Price reveal with shocked reaction"].map(t=>(
                <div key={t} style={{ background:T.surface,borderRadius:10,padding:"11px 14px",fontSize:13,color:T.text,border:`1px solid ${T.border}` }}>🔥 {t}</div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </LockedFeature>
    ),

    growth: (
      <LockedFeature label="Growth Strategy — KING Feature">
        <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
          <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Growth & Followers</div><p style={{ color:T.muted,fontSize:14 }}>Platform-by-platform playbooks to grow fast</p></motion.div>
          {[{platform:"Instagram",icon:"📸",color:"#e1306c",tips:["Post Reels daily at 7-9 PM for 3x reach","Use 5-10 niche hashtags, not mega-viral ones","Reply to every comment in first 30 minutes","Collaborate with accounts 20% larger than yours","Share UGC testimonials in Stories highlight"]},
            {platform:"TikTok",icon:"🎵",color:"#ff0050",tips:["Hook in first 2 seconds or lose 80% of viewers","Trending audio = 3x organic reach boost","Post 2-3x/day to test content formats","Add text overlay for silent viewers","Duet viral videos in your exact niche"]},
            {platform:"YouTube Shorts",icon:"▶️",color:"#ff0000",tips:["Optimize title with buyer-intent keywords","First frame must stop the scroll completely","Loop-friendly endings get replayed = more views","Comment 'Watch till end' builds pattern curiosity","Cross-post Reels and TikToks here for free reach"]},
          ].map(p=>(
            <motion.div key={p.platform} variants={fadeUp} className="solid-card" style={{ padding:22 }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
                <span style={{ fontSize:22 }}>{p.icon}</span>
                <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:18 }}>{p.platform}</div>
                <span className="badge" style={{ background:p.color+"20",color:p.color,border:`1px solid ${p.color}40` }}>Growth Guide</span>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10 }}>
                {p.tips.map((t,i)=><div key={i} style={{ display:"flex",gap:8 }}><span style={{ color:p.color,flexShrink:0 }}>→</span><span style={{ fontSize:13.5,color:T.text,lineHeight:1.5 }}>{t}</span></div>)}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </LockedFeature>
    ),

    payment: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Payment Setup Guide</div><p style={{ color:T.muted,fontSize:14 }}>Accept money globally in minutes</p></motion.div>
        {[{n:"Stripe",i:"💳",c:"#635bff",s:["Go to stripe.com → Create free account","Add business details + bank account","Copy Publishable + Secret API keys","In Lovable.dev, add Stripe payment element","Test with: 4242 4242 4242 4242"],b:"US, UK, EU, Canada, Australia"},
          {n:"PayPal",i:"🅿️",c:"#003087",s:["Create PayPal Business account (free)","Developer Dashboard → My Apps","Create app → Copy Client ID","Add PayPal button to your Lovable site","Enable PayPal Checkout in settings"],b:"Global, widely trusted"},
          {n:"Local Gateways",i:"🏦",c:T.green,s:["Pakistan: JazzCash / EasyPaisa / Safepay","India: Razorpay / Paytm / Cashfree","Nigeria: Paystack / Flutterwave","UAE: Telr / PayTabs / Checkout.com","Sign up → get API key → paste in Lovable"],b:"Local customers, lowest fees"},
          {n:"Cash on Delivery",i:"📦",c:T.gold,s:["Enable COD in your Lovable store settings","Set COD handling fee ($1-3)","Verify orders via WhatsApp before shipping","Build COD tracking sheet","Follow up post-delivery to reduce returns"],b:"Pakistan, Middle East, South Asia"},
        ].map(gw=>(
          <motion.div key={gw.n} variants={fadeUp} className="solid-card" style={{ padding:22 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
              <span style={{ fontSize:22 }}>{gw.i}</span>
              <div><div style={{ fontFamily:"Bricolage Grotesque",fontWeight:700,fontSize:17,color:gw.c }}>{gw.n}</div><div style={{ fontSize:11,color:T.muted }}>Best for: {gw.b}</div></div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:8 }}>
              {gw.s.map((s,i)=>(
                <div key={i} style={{ display:"flex",gap:10 }}>
                  <div style={{ width:22,height:22,borderRadius:"50%",background:gw.c+"25",border:`1px solid ${gw.c}50`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:gw.c,flexShrink:0 }}>{i+1}</div>
                  <span style={{ fontSize:13,color:T.text,paddingTop:2,lineHeight:1.5 }}>{s}</span>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </motion.div>
    ),

    motivation: (
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ display:"flex",flexDirection:"column",gap:20 }}>
        <motion.div variants={fadeUp}><div style={{ fontFamily:"Bricolage Grotesque",fontSize:24,fontWeight:800,marginBottom:4 }}>Daily Motivation</div><p style={{ color:T.muted,fontSize:14 }}>Your mindset is your most valuable business asset</p></motion.div>
        <motion.div variants={scaleIn} style={{ background:`linear-gradient(135deg,${T.accent},${T.accentB})`,borderRadius:20,padding:"40px 32px",textAlign:"center",position:"relative",overflow:"hidden" }}>
          <div style={{ position:"absolute",top:-40,right:-40,width:180,height:180,background:"#ffffff10",borderRadius:"50%" }}/>
          <div style={{ fontSize:40,marginBottom:16 }}>🔥</div>
          <p style={{ fontFamily:"Bricolage Grotesque",fontSize:"clamp(18px,3vw,26px)",fontWeight:700,color:"#fff",lineHeight:1.4,maxWidth:500,margin:"0 auto" }}>"{quote}"</p>
          <p style={{ color:"#ffffff70",fontSize:12,marginTop:14 }}>— Aisentials Daily, {new Date().toLocaleDateString()}</p>
        </motion.div>
        <motion.div variants={stagger} style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }} className="grid-2">
          {QUOTES.map((q,i)=>(
            <motion.div key={i} variants={fadeUp} className="solid-card" style={{ padding:20,borderLeft:`3px solid ${[T.accent,T.gold,T.green,T.red,T.accent,T.gold,T.green,T.red][i%8]}` }}>
              <p style={{ fontSize:14,color:T.text,fontStyle:"italic",lineHeight:1.6 }}>"{q}"</p>
            </motion.div>
          ))}
        </motion.div>
        <motion.div variants={fadeUp} className="solid-card" style={{ padding:24,textAlign:"center",background:`linear-gradient(135deg,${T.gold}12,${T.card})`,borderColor:`${T.gold}30` }}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontWeight:800,fontSize:20,color:T.gold,marginBottom:8 }}>Your business is running right now.</div>
          <p style={{ color:T.muted,fontSize:14,lineHeight:1.7,maxWidth:500,margin:"0 auto" }}>While you read this, {brand.name} is live, your website is converting visitors, and your content calendar is ready. You've already done the hard part.</p>
        </motion.div>
      </motion.div>
    ),
  };

  return (
    <div style={{ minHeight:"100vh" }}>
      <div className="m-header">
        <div style={{ fontFamily:"Bricolage Grotesque",fontSize:18,fontWeight:800 }}>Ai<span style={{ color:T.accent }}>sentials</span></div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          {isKing && <KingBadge/>}
          <motion.button style={{ background:"none",border:"none",cursor:"pointer",color:T.text,fontSize:22 }} onClick={()=>setSideOpen(!sideOpen)} whileTap={{ scale:.9 }}>☰</motion.button>
        </div>
      </div>

      {sideOpen && <div className="overlay-bg" onClick={()=>setSideOpen(false)} style={{ zIndex:99 }}/>}

      <div className={`sidebar ${sideOpen?"open":""}`}>
        <div style={{ padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}` }}>
          <div style={{ fontFamily:"Bricolage Grotesque",fontSize:22,fontWeight:800,marginBottom:14 }}>Ai<span style={{ color:T.accent }}>sentials</span></div>
          <div style={{ display:"flex",gap:8,flexDirection:"column" }}>
            <div style={{ fontSize:12,color:T.muted }}>Welcome back,</div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <div style={{ fontSize:14,fontWeight:600,color:T.text }}>{user.name}</div>
              {isKing && <span className="king-crown">👑</span>}
            </div>
            <div className="badge badge-purple" style={{ alignSelf:"flex-start" }}>{brand.name}</div>
          </div>
        </div>

        {isKing ? (
          <div className="king-sidebar-banner">
            <div className="king-title">👑 KING Member</div>
            <div className="king-sub">All features unlocked</div>
          </div>
        ) : (
          <div className="free-sidebar-banner" onClick={showPaywall}>
            <div className="free-title">Free Account</div>
            <div className="free-cta">👑 Upgrade to KING →</div>
          </div>
        )}

        <div style={{ padding:"12px 8px",flex:1 }}>
          {NAV.map(n=>(
            <div key={n.id} className={`nav-item ${nav===n.id?"active":""}`} onClick={()=>navClick(n)}>
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.king&&!isKing&&<span className="nav-lock">👑</span>}
            </div>
          ))}
        </div>

        <div style={{ padding:"16px 20px",borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:11,color:T.muted,marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:".06em" }}>Active Niche</div>
          <div style={{ fontSize:13,color:T.text,fontWeight:500 }}>{niche.name}</div>
          <div style={{ fontSize:11,color:T.green,marginTop:2 }}>{niche.margin} margin · {niche.viral}% viral</div>
          {supabase && (
            <motion.button className="btn btn-ghost btn-sm" style={{ marginTop:12,width:"100%",color:T.muted }} whileHover={{ scale:1.02 }} onClick={async()=>{ await sbSignOut(); window.location.reload(); }}>
              Sign Out
            </motion.button>
          )}
        </div>
      </div>

      <div className="main-content" style={{ marginLeft:256,padding:"32px 32px 60px" }}>
        <div style={{ maxWidth:1000,margin:"0 auto" }}>
          <AnimatePresence mode="wait">
            <motion.div key={nav} initial={{ opacity:0,y:16 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-8 }} transition={{ duration:.3,ease:[.16,1,.3,1] }}>
              {sections[nav]||sections.overview}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// KING PROVIDER — manages auth, profile, realtime, paywall state
// ═══════════════════════════════════════════════════════════════════
function KingProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const isKing = profile?.is_king === true;

  const showPaywall = useCallback(() => setPaywallOpen(true), []);
  const hidePaywall = useCallback(() => setPaywallOpen(false), []);

  return (
    <KingCtx.Provider value={{ isKing, profile, showPaywall, setProfile }}>
      {children}
      <AnimatePresence>{paywallOpen && <PaywallModal onClose={hidePaywall}/>}</AnimatePresence>
    </KingCtx.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════
const STEPS = { SPLASH:0, AUTH:1, ONBOARD:2, NICHE:3, BRAND:4, LOGO:5, WEBSITE:6, DASH:7 };

function AppInner() {
  const { setProfile } = useKing();
  const [step, setStep] = useState(STEPS.SPLASH);
  const [user, setUser] = useState(null);
  const [profile, setLocalProfile] = useState(null);
  const [niche, setNiche] = useState(null);
  const [brand, setBrand] = useState(null);
  const [logo, setLogo] = useState(null);
  const [website, setWebsite] = useState("");
  const [sbUser, setSbUser] = useState(null);

  // Restore session on mount
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        const u = data.session.user;
        setSbUser(u);
        sbFetchProfile(u.id).then(({ data: p }) => {
          if (p) { setProfile(p); setLocalProfile(p); }
        });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setSbUser(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Realtime profile listener — detects is_king changes instantly
  useEffect(() => {
    if (!sbUser?.id) return;
    const unsub = sbSubscribeProfile(sbUser.id, (updated) => {
      setProfile(updated);
      setLocalProfile(updated);
    });
    return unsub;
  }, [sbUser?.id]);

  const handleAuth = async ({ email, name, isNew, sbUser: su }) => {
    if (su) {
      setSbUser(su);
      await sbEnsureProfile(su);
      const { data: p } = await sbFetchProfile(su.id);
      if (p) { setProfile(p); setLocalProfile(p); }
    }
    setUser({ email, name });
    setStep(isNew ? STEPS.ONBOARD : STEPS.NICHE);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="noise"/>
      <div className="mesh-bg"/>

      <AnimatePresence mode="wait">
        {step===STEPS.SPLASH && (
          <motion.div key="splash" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0,scale:.96 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <SplashScreen onEnter={()=>setStep(STEPS.AUTH)}/>
          </motion.div>
        )}
        {step===STEPS.AUTH && (
          <motion.div key="auth" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <AuthScreen onAuth={handleAuth}/>
          </motion.div>
        )}
        {step===STEPS.ONBOARD && (
          <motion.div key="onboard" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <OnboardScreen user={user} onDone={p=>{ setLocalProfile(prev=>({...prev,...p})); setStep(STEPS.NICHE); }}/>
          </motion.div>
        )}
        {step===STEPS.NICHE && (
          <motion.div key="niche" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <NicheScreen onSelect={n=>{ setNiche(n); setStep(STEPS.BRAND); }}/>
          </motion.div>
        )}
        {step===STEPS.BRAND && niche && (
          <motion.div key="brand" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <BrandScreen niche={niche} onSelect={b=>{ setBrand(b); setStep(STEPS.LOGO); }}/>
          </motion.div>
        )}
        {step===STEPS.LOGO && brand && (
          <motion.div key="logo" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <LogoScreen brand={brand} niche={niche} onSelect={l=>{ setLogo(l); setStep(STEPS.WEBSITE); }}/>
          </motion.div>
        )}
        {step===STEPS.WEBSITE && brand && (
          <motion.div key="website" initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }} transition={{ duration:.4 }} style={{ position:"relative",zIndex:1 }}>
            <WebsiteScreen brand={brand} niche={niche} logo={logo} onDone={url=>{ setWebsite(url); setStep(STEPS.DASH); }}/>
          </motion.div>
        )}
        {step===STEPS.DASH && niche && brand && (
          <motion.div key="dash" initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:.5 }} style={{ position:"relative",zIndex:1 }}>
            <Dashboard user={user||{name:"Founder"}} profile={profile||{country:"Global",ig:""}} niche={niche} brand={brand} logo={logo} website={website} sbUser={sbUser}/>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <KingProvider>
      <AppInner/>
    </KingProvider>
  );
}
