    // STUDIO埋め込み用: iframeの外側に実際のコンテンツ高さを伝えて、
    // 埋め込み側でiframeの高さを合わせてもらう(固定アスペクト比だと
    // スマホ幅で縦に入りきらず見切れることがあるための対策)
    function postHeightToParent() {
      if (window.parent === window) return;
      requestAnimationFrame(() => {
        const height = document.documentElement.scrollHeight;
        window.parent.postMessage({ type: 'mif-maps-resize', height: height }, '*');
      });
    }
    window.addEventListener('load', postHeightToParent);
