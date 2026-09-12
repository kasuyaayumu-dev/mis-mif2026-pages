    // STUDIO埋め込み用: iframeの外側に実際のコンテンツ高さを伝えて、
    // 埋め込み側でiframeの高さを合わせてもらう(固定アスペクト比だと
    // スマホ幅で縦に入りきらず見切れることがあるための対策)
    function postHeightToParent() {
      if (window.parent === window) return;
      requestAnimationFrame(() => {
        const height = document.documentElement.scrollHeight;
        // 埋め込み先(STUDIOの各公開ドメイン)を事前に特定できないため target origin は '*' を使用。
        // 送信内容はページの高さ(数値)のみで機密情報は含まない。
        window.parent.postMessage({ type: 'mif-maps-resize', height: height }, '*'); // NOSONAR
      });
    }
    window.addEventListener('load', postHeightToParent);
