(()=>{
  const text=(el)=>el?.textContent?.trim()||"";
  const routeForType=t=>t==="podcast"?"podcast.html":t==="videoessay"?"video.html":t==="article"?"article.html":t==="note"?"article.html":"index.html";

  // Home: approved cards are <article>, so make the whole editorial module behave like a link.
  if(document.body.classList.contains("page-home")){
    document.querySelectorAll(".hero-material,.side-item,.podcast-feature,.article-feature,.video-feature,.archive-card").forEach(el=>{
      let href="index.html";
      if(el.matches(".hero-material,.video-feature")) href="video.html";
      else if(el.matches(".podcast-feature")) href="podcast.html";
      else if(el.matches(".article-feature")) href="article.html";
      else if(el.matches(".side-item")){
        const k=text(el.querySelector(".kicker")).toLowerCase(); href=k.includes("подкаст")?"podcast.html":k.includes("статья")?"article.html":"article.html";
      } else href=routeForType(el.dataset.type);
      el.dataset.href=href; el.tabIndex=0; el.setAttribute("role","link");
      el.addEventListener("click",e=>{if(e.target.closest("a,button"))return; location.href=href});
      el.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("a,button")){e.preventDefault();location.href=href}});
    });
    document.querySelectorAll(".older-card").forEach(a=>a.href=routeForType(a.dataset.type));
  }

  // Empty search submits to the approved results page.
  if(document.body.classList.contains("page-search-empty")){
    const form=document.querySelector(".search-page form"), input=form?.querySelector('input[type="search"]');
    form?.addEventListener("submit",e=>{e.preventDefault();const q=input.value.trim();if(q) location.href="search-results.html?q="+encodeURIComponent(q)});
  }

  // Search results: filters are functional and stay grouped by result type.
  if(document.body.classList.contains("page-search-results")){
    const params=new URLSearchParams(location.search);const q=params.get("q");
    const input=document.querySelector('.search-page input[type="search"]'); if(q&&input) input.value=q;
    const groups=[...document.querySelectorAll(".result-group")];
    groups.forEach(g=>{
      const h=text(g.querySelector(".group-head h2")).toLowerCase();
      g.dataset.scope=h.includes("аниме")?"anime":h.includes("материал")?"material":"mention";
    });
    const opts=[...document.querySelectorAll(".scope-option")];
    opts.forEach((b,i)=>{b.dataset.scope=i===0?"all":i===1?"material":i===2?"anime":"mention";b.addEventListener("click",()=>{opts.forEach(x=>x.classList.toggle("active",x===b));groups.forEach(g=>g.hidden=b.dataset.scope!=="all"&&g.dataset.scope!==b.dataset.scope)})});
    document.querySelector(".search-page form")?.addEventListener("submit",e=>{e.preventDefault();const val=input.value.trim();if(val)location.href="search-results.html?q="+encodeURIComponent(val)});
  }
})();