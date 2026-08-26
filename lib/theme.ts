// Theme bootstrap helper. Renders a tiny inline script in <head> so the
// page paints in the right theme before Tailwind/CSS arrives.

export function themeBootstrapScript(): string {
  return `(function(){try{var s=localStorage.getItem("mig-theme");var m=s||"auto";var d=m==="auto"?matchMedia("(prefers-color-scheme: dark)").matches:m==="dark";document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})();`;
}
