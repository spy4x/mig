// Theme bootstrap helper. Renders a tiny inline script in <head> so the
// page paints in the right theme before Tailwind/CSS arrives, with no
// flash of wrong-coloured content.
//
// `mode` is the user's stored preference (`light`, `dark`, or `auto`).
// We expose `__migTheme()` on `window` so the ThemeToggle island can
// mutate the stored mode + update the DOM without round-tripping the
// server. `data-theme` is also set on <html> for any consumer that wants
// to react to it via CSS attribute selectors.

export function themeBootstrapScript(): string {
  return `(function(){try{
var K="mig-theme";
var s=localStorage.getItem(K);
var m=(s==="light"||s==="dark")?s:"auto";
var prefersDark=matchMedia("(prefers-color-scheme: dark)").matches;
var dark=m==="dark"||(m==="auto"&&prefersDark);
document.documentElement.classList.toggle("dark",dark);
document.documentElement.dataset.theme=dark?"dark":"light";
window.__migTheme={mode:function(){return m},apply:function(next){
if(next!=="light"&&next!=="dark"&&next!=="auto")return m;
m=next;
try{localStorage.setItem(K,next)}catch(_e){}
var d2=next==="dark"||(next==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d2);
document.documentElement.dataset.theme=d2?"dark":"light";
return next;
}};
if(matchMedia){
var mq=matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener("change",function(){
if(m!=="auto")return;
var d3=mq.matches;
document.documentElement.classList.toggle("dark",d3);
document.documentElement.dataset.theme=d3?"dark":"light";
});
}
}catch(_e){}})();`;
}
