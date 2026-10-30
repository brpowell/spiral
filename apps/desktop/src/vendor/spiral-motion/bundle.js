/* @ds-bundle: {"format":4,"namespace":"Spiral","components":[{"name":"LogoReveal"},{"name":"LogoDance"},{"name":"LogoLoader"}]} */
/* Spiral logo motion. Plain script, no dependencies, no network, no font files: the glyph and the
   outlined wordmark are drawn as SVG paths and every sound is synthesised with Web Audio.
   Vanilla:  Spiral.LogoReveal.mount(element, options) -> controller
   React:    <Spiral.LogoReveal {...options} />   (needs window.React)                              */
(function () {
  "use strict";

  // ---- Geometry: glyph in its own path space (centre 510, 501.75); wordmark from the official
  //      lockup (Gabarito 550, -0.01em, outlined), shifted into glyph space by WORD_OFF. ----
  var A_BODY = "M353.53 433.66C349.59 435.56 347.03 439.54 343.82 442.46C327.74 457.1 319.55 474.83 322.92 496.98C323.61 501.51 325.65 505.87 327.09 510.19C336.24 537.74 364.43 563.34 388.74 577.75C397.3 582.82 406.86 587.76 416.66 589.97C435.13 594.13 452.74 594.31 470.31 586.74C472.71 585.7 475.03 584.89 477.18 583.32C495.49 569.94 503.88 550.69 501.02 527.94C499.96 519.56 496.21 512.14 492.67 504.64C489.83 498.64 486.85 490.3 481.79 485.99C479.31 482.03 476.83 478.07 474.35 474.11C471.38 469.13 468.4 464.15 465.42 459.16C464.29 457.31 463.15 455.45 462.02 453.59C459.02 444.61 454.86 436.72 454.79 426.9C454.6 401.11 478.72 379.14 496.66 363.39C499.14 361.21 502 359.37 504.38 357.09C525.4 337.01 548 318.36 569.98 299.25C589.76 282.05 608.96 263.89 629.02 246.99C643.7 234.62 657.74 221.38 671.91 208.54C676.9 204.02 685.9 198.71 687.97 191.98C691.11 181.8 684.04 174.99 676.96 168.86C663.71 157.39 655.89 165.21 645.29 174.44C634.26 184.05 623.35 193.67 612.45 203.33C606.03 209.01 599.92 215.25 593.21 220.58C577.91 232.75 563.86 246.75 549.14 259.69C517.49 287.51 486.41 316.16 454.62 343.77C430.91 364.36 407.72 385.43 384.19 406.17C374.71 414.53 361.59 424.22 353.53 433.66Z";
  var B_BODY = "M549.91 514.7C551.37 516.46 552.83 518.22 554.29 519.97C556.21 524.54 560.31 528.32 563.02 532.52C571.49 545.67 580.98 559.17 580.81 575.59C580.55 600.26 562.46 619.21 546.19 635.52C511.54 670.27 474.81 703.25 438.62 736.47C422.98 750.83 407.43 765.03 391.87 779.49C383.97 786.85 375.54 793.77 367.92 801.37C360.46 808.8 347.33 816.63 354.41 828.99C355.43 830.76 357.4 832.5 358.96 833.82C364.83 838.74 371.29 842.93 379.21 839.86C385.89 837.27 394.48 827.3 400.23 822.45C414.73 810.21 429.09 797.65 443.2 785.02C499.34 734.72 557 686.22 613.63 636.55C631.09 621.23 648.38 605.85 665.96 590.67C672.16 585.32 684.08 575.94 687.37 568.64C688.05 567.71 688.74 566.79 689.43 565.87C691.48 563.86 692.04 561.58 693.31 559.05C701.87 542.01 698.29 523.3 692.43 506.03C689.41 497.1 684.37 489.39 679.55 481.42C660.19 449.41 618.74 415.18 580.27 412.1C572.77 411.5 564.84 411.81 557.59 413.91C548.84 416.44 540.25 420 533.75 426.66C511.92 449.03 524.49 479.8 539.99 501.32C543.22 505.8 545.73 511.03 549.91 514.7Z";
  var A_ACC = "M472.25 476.98C475.17 480.24 478.1 483.49 481.02 486.75C481.28 486.5 481.53 486.24 481.79 485.99C486.85 490.3 489.83 498.64 492.67 504.64C496.21 512.14 499.96 519.56 501.02 527.94C503.88 550.69 495.49 569.94 477.18 583.32C475.03 584.89 472.71 585.7 470.31 586.74C452.74 594.31 435.13 594.13 416.66 589.97C406.86 587.76 397.3 582.82 388.74 577.75C364.43 563.34 336.24 537.74 327.09 510.19C325.65 505.87 323.61 501.51 322.92 496.98C319.55 474.83 327.74 457.1 343.82 442.46C347.03 439.54 349.59 435.56 353.53 433.66C357.2 433.4 360.53 431 364.24 430.22C370.05 429.01 376.1 428.73 382.01 429.14C406.99 430.86 431.49 443.22 450.93 458.53C455.61 462.22 460.24 466.04 464.7 469.98C467.27 472.23 469.47 475.11 472.25 476.98Z";
  var B_ACC = "M689.43 565.87C689.63 565.37 689.83 564.87 690.03 564.37C688.51 564.96 686.99 565.55 685.47 566.14C679.86 568.36 674.1 570.39 668.05 571.01C641.84 573.68 607.25 559.01 586.31 543.82C578.77 538.35 571.29 532.62 564.11 526.74C560.99 524.2 558.57 520.29 554.79 518.86C553.58 516.6 552.49 515.1 549.91 514.7C545.73 511.03 543.22 505.8 539.99 501.32C524.49 479.8 511.92 449.03 533.75 426.66C540.25 420 548.84 416.44 557.59 413.91C564.84 411.81 572.77 411.5 580.27 412.1C618.74 415.18 660.19 449.41 679.55 481.42C684.37 489.39 689.41 497.1 692.43 506.03C698.29 523.3 701.87 542.01 693.31 559.05C692.04 561.58 691.48 563.86 689.43 565.87Z";
  var WORD = "M597.9 519.83Q569.34 519.83 543.75 511.33Q518.16 502.83 497.4 484.51Q476.64 466.18 462.56 436.09L512.54 406.01Q529 434.19 550.27 447.61Q571.54 461.03 600.6 461.03Q627.47 461.03 641.26 449.37Q655.06 437.72 655.06 417.96Q655.06 405.94 649.08 396.9Q643.11 387.85 627.6 379.95Q612.09 372.06 583.54 365.32Q542.43 355.16 519.07 340.02Q495.72 324.89 486.34 304.59Q476.97 284.29 476.97 259.8Q476.97 230.46 491.06 208.05Q505.16 185.63 531.6 172.73Q558.05 159.83 594.31 159.83Q636.72 159.83 665.06 176.22Q693.4 192.6 711.55 220.12L661.2 254.04Q646.63 235.77 628.87 227.82Q611.11 219.88 592.24 219.88Q566.75 219.88 553.02 229.87Q539.29 239.87 539.29 258.32Q539.29 274.62 552.59 286.13Q565.9 297.64 604.83 306.91Q647.51 317.29 672.53 331.92Q697.55 346.55 708.34 367.21Q719.14 387.87 719.14 417Q719.14 446.12 704.32 469.29Q689.5 492.46 662.26 506.14Q635.02 519.83 597.9 519.83ZM889.31 517.44Q856.22 517.44 831.69 501.95Q807.16 486.46 793.48 457.42Q779.8 428.38 779.8 388Q779.8 348.13 793.63 319.1Q807.45 290.06 832.06 273.95Q856.66 257.84 889.61 257.84Q923.87 257.84 949.53 274.32Q975.19 290.8 989.56 319.98Q1003.94 349.17 1003.94 388Q1003.94 426.32 989.49 455.58Q975.04 484.84 949.23 501.14Q923.42 517.44 889.31 517.44ZM757.91 608.31V263.51H805.08L820.66 320.23H815.73V448.67H820.66V608.31ZM878.74 460.32Q905.82 460.32 922.92 440.27Q940.02 420.21 940.02 388Q940.02 355.42 922.92 335.11Q905.82 314.8 878.74 314.8Q852.02 314.8 834.78 334.93Q817.53 355.06 817.53 387.64Q817.53 420.21 834.78 440.27Q852.02 460.32 878.74 460.32ZM1106.74 511.77H1043.84V263.51H1106.74ZM1036.8 186.26Q1036.8 168.87 1047.24 158.07Q1057.68 147.27 1075.29 147.27Q1092.68 147.27 1103.22 158.07Q1113.77 168.87 1113.77 186.26Q1113.77 202.99 1103.22 213.72Q1092.68 224.44 1075.29 224.44Q1057.68 224.44 1047.24 213.72Q1036.8 202.99 1036.8 186.26ZM1208.38 263.51 1224.11 331.46V511.77H1161.36V263.51ZM1212.07 362.62 1199.58 357.03V309.47L1204.3 303.73Q1209.82 294.73 1221.04 284.02Q1232.26 273.31 1247.29 265.57Q1262.32 257.84 1278.16 257.84Q1286.07 257.84 1292.79 258.93Q1299.5 260.02 1303.2 262.56V319.34H1287.01Q1253.49 319.34 1236.34 329.83Q1219.18 340.32 1212.07 362.62ZM1399.95 518.73Q1372.02 518.73 1351.33 508.42Q1330.65 498.11 1319.5 479.13Q1308.36 460.15 1308.36 434.47Q1308.36 409.19 1320.05 390.36Q1331.75 371.52 1352.51 360.86Q1373.26 350.2 1400.25 350.2Q1436.4 350.2 1458.74 366.57Q1481.07 382.95 1489.12 412.81L1458.75 409.86V349.15Q1458.75 334.43 1448.59 322.76Q1438.44 311.1 1414.45 311.1Q1400.37 311.1 1383.06 314.48Q1365.74 317.85 1347 326.57L1328.52 280.22Q1350.09 269.62 1374.14 263.73Q1398.19 257.84 1422.34 257.84Q1455.67 257.84 1477.76 269.89Q1499.85 281.95 1510.75 302.84Q1521.65 323.73 1521.65 350.77V511.77H1472.68L1458.94 465.07L1489.12 456.12Q1480.41 486.4 1457.33 502.56Q1434.26 518.73 1399.95 518.73ZM1416.17 469.38Q1435.43 469.38 1447.24 460Q1459.04 450.61 1459.04 434.47Q1459.04 417.96 1447.24 408.75Q1435.43 399.55 1416.17 399.55Q1396.62 399.55 1384.89 408.75Q1373.16 417.96 1373.16 434.47Q1373.16 450.61 1384.89 460Q1396.62 469.38 1416.17 469.38ZM1624.45 514.31Q1608.44 514.31 1595.4 507.37Q1582.36 500.42 1574.6 486.17Q1566.84 471.91 1566.84 449.55V165.73H1628.88V427.49Q1628.88 444.72 1636.16 450.16Q1643.45 455.6 1653.91 455.6V510.41Q1648.04 512.36 1640.12 513.33Q1632.2 514.31 1624.45 514.31Z";
  var WORD_OFF = [322, 163];
  var CX = 510, CY = 501.75;
  var HEAD_A = [412, 511], HEAD_B = [608, 492];
  var WORD_RIGHT = 1975.91;                                // wordmark right edge (glyph space)
  var LOCKUP_VB = [228, 69, 1841.91, 865.5];               // the official lockup's frame, clear space included
  var SQUARE_VB = [120, 111.75, 780, 780];
  var DIR_A = (function () { var x = HEAD_A[0] - CX, y = HEAD_A[1] - CY, l = Math.hypot(x, y); return [x / l, y / l]; })();
  var DIR_B = [-DIR_A[0], -DIR_A[1]];

  // ---- Locked-in timing (beats; 150 bpm) and sound design ----
  var TIMING = {
    bpm: 150, spinStyle: "toss", windAmt: 55, windLen: 0.9, windCoil: 0.07, windShake: 0,
    nodAmt: 0, nodLen: 0.6, spinStart: 6.6, spinLen: 1.2, overshoot: 1.9,
    slideOffset: -0.1, slideLen: 1.2, wordDelay: -0.2, wordLen: 1.3, wordTuck: -44, loopHold: 4,
    loaderBeat: 1.1
  };
  var SOUND = {
    masterVol: 0.8, reverb: 0.35,
    clickStyle: "snap", clickVol: 1.45, clickPitch: 150, clickBright: 2600, clickSnap: 22, clickBody: 80, popSize: 0.4,
    chimeVol: 1, chimeChord: "major", chimeKey: 0, chimeDecay: 1.8, chimeShimmer: 7, chimeGlass: 1, chimeBubble: 1, chimeSpace: 0.6, chimeWidth: 0.35,
    lightVol: 1, lightPitch: 0.6, lightFocus: 1.4, lightWidth: 0.3, lightSpace: 0.25,
    heavyVol: 1, heavyPitch: 1.8, heavyFocus: 0.9, heavyHum: 0.15, heavyWidth: 0.6
  };
  var CHORDS = { major: [0, 4, 7, 12], add9: [0, 4, 7, 14], sus2: [0, 2, 7, 12], fifths: [0, 7, 12, 19], minor: [0, 3, 7, 12] };
  var DANCE_LEN = 8, DANCE_REST = 1.2, POP_AT = 0.82, POP_LEN = 0.55;

  // ---- Easing and keyframe tracks ----
  var E = {
    io3: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    io4: function (t) { return t < .5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; },
    o3: function (t) { return 1 - Math.pow(1 - t, 3); },
    o4: function (t) { return 1 - Math.pow(1 - t, 4); },
    i2: function (t) { return t * t; },
    ioS: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    oBack: function (t) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };
  function backEase(c1) { var c3 = c1 + 1; return function (t) { return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }; }
  function track(b, keys) {
    if (b <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      var k1 = keys[i], k0 = keys[i - 1];
      if (b <= k1[0]) { var e = k1[2]; var f = typeof e === "function" ? e : E[e || "io3"]; return k0[1] + (k1[1] - k0[1]) * f((b - k0[0]) / (k1[0] - k0[0])); }
    }
    return keys[keys.length - 1][1];
  }
  function hop(b, at, h) {
    var x = (b - at) / 0.5; if (x < 0 || x > 1) return 0;
    return x < .5 ? -h * E.o3(x * 2) : -h * (1 - E.i2((x - .5) * 2));
  }

  // ---- Choreography ----
  function loaderPose(b) {
    var k = Math.floor(b), p = b - k, s = Math.sin(Math.PI * p);
    var trail = -22 * s * s * (p < .5 ? 1 : 1 - (p - .5) * 0.4);
    return { R: 180 * (k + E.io4(p)), S: 1 - 0.05 * s, d: 26 * s * s, hopA: 0, hopB: 0, rotA: trail, rotB: trail, X: 0 };
  }
  function dancePose(b, P) {
    var cycle = DANCE_LEN + DANCE_REST, k = Math.floor(b / cycle), t = b - k * cycle;
    var R = 180 * k + track(t, [[0, 0], [0.8, -14, "io3"], [6.4, -14], [6.6, -20, "ioS"], [7.8, 180, "oBack"]]);
    var S = track(t, [[0, 1], [0.8, 0.88, "ioS"], [1.3, 0.8, "oBack"], [1.6, 0.76, "ioS"], [6.4, 0.76], [6.8, 0.9, "ioS"], [7.3, 1.04, "o3"], [7.8, 1, "ioS"]]);
    var d = track(t, [[0, 0], [0.8, -8, "ioS"], [1.4, 64, "oBack"], [6.2, 64], [6.8, -10, "i2"], [7.1, 0, "o3"]]);
    var hopA = hop(t, 2, 48) + hop(t, 3, 48), hopB = hop(t, 2.5, 48) + hop(t, 3.5, 48);
    var spin = track(t, [[0, 0], [4, 0], [5.6, 360, "io3"], [6.2, 360]]);
    var nod = P.nodAmt > 0 ? track(t, [[5.6, 0], [5.6 + P.nodLen * 0.42, -P.nodAmt, "o3"], [5.6 + P.nodLen, 0, "ioS"]]) : 0;
    return { R: R, S: S, d: d, hopA: hopA, hopB: hopB, rotA: spin + hopA * 0.25 + nod, rotB: spin - hopB * 0.25 + nod, X: 0, t: t };
  }
  function revealTimes(P) {
    var s0 = P.spinStart, s1 = s0 + P.spinLen, x0 = s0 + P.slideOffset, x1 = x0 + P.slideLen, w0 = x0 + P.wordDelay, w1 = w0 + P.wordLen;
    return { s0: s0, s1: s1, x0: x0, x1: x1, w0: w0, w1: w1, end: Math.max(s1, x1, w1) };
  }
  function revealPose(b, P, startX) {
    var T = revealTimes(P), p = dancePose(Math.min(b, DANCE_LEN), P);
    if (P.spinStyle === "toss") {
      var w0 = Math.max(0.9, T.s0 - P.windLen), wound = -14 - P.windAmt;
      p.R = track(b, [[0, 0], [0.8, -14, "io3"], [w0, -14], [T.s0, wound, "ioS"], [T.s1, 180, "o4"]]);
      var k = b > w0 && b < T.s0 ? (b - w0) / (T.s0 - w0) : 0;
      p.R += P.windShake * 2.5 * k * k * Math.sin(b * Math.PI * 2 * 7);
      p.S *= track(b, [[w0, 1], [T.s0, 1 - P.windCoil, "ioS"], [T.s0 + 0.35, 1, "o3"]]);
      var lag = track(b, [[w0, 0], [T.s0, P.windAmt * 0.3, "ioS"], [T.s0 + 0.4, -10, "o3"], [T.s0 + 0.9, 0, "ioS"]]);
      p.rotA += lag; p.rotB += lag;
    } else {
      p.R = track(b, [[0, 0], [0.8, -14, "io3"], [Math.max(0.9, T.s0 - 0.2), -14], [T.s0, -20, "ioS"], [T.s1, 180, backEase(P.overshoot)]]);
    }
    p.X = b < T.x0 ? startX : startX * (1 - track(b, [[T.x0, 0], [T.x1, 1, "io3"]]));
    p.wordProg = b < T.w0 ? 0 : track(b, [[T.w0, 0], [T.w1, 1, "io3"]]);
    p.t = b;
    return p;
  }

  // LogoDance: the reveal's exact choreography (wind-up toss, clean stops) with no slide and no
  // wordmark, then a short rest and again. The glyph looks the same after a half turn, so the
  // restart is seamless.
  function loopDancePose(b, P) {
    var cycle = revealTimes(P).end + DANCE_REST, k = Math.floor(b / cycle), t = b - k * cycle;
    var p = revealPose(t, P, 0);
    p.X = 0; p.t = t;
    return p;
  }

  // ---- SVG ----
  var SVGNS = "http://www.w3.org/2000/svg", uid = 0;
  function node(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var INK = "var(--spiral-mark, var(--brand-glyph, #202c0c))";
  var LEAF = "var(--spiral-accent, var(--brand-glyph-accent, #608123))";

  function buildSvg(mode, label) {
    var id = "spiral-motion-" + (++uid);
    var vb = mode === "reveal" ? LOCKUP_VB : SQUARE_VB;
    var svg = node("svg", { viewBox: vb.join(" "), role: "img", "aria-label": label || "Spiral" });
    svg.style.cssText = "display:block;width:100%;height:auto;overflow:visible";
    var defs = node("defs", {}, svg);
    node("path", { d: A_BODY }, node("clipPath", { id: id + "a" }, defs));
    node("path", { d: B_BODY }, node("clipPath", { id: id + "b" }, defs));
    var m = { svg: svg };
    if (mode === "reveal") {
      var clip = node("clipPath", { id: id + "w" }, defs);
      m.wordClip = node("rect", { x: 0, y: -2000, width: 8000, height: 8000 }, clip);
      var wg = node("g", { "clip-path": "url(#" + id + "w)" }, svg);
      m.word = node("g", {}, wg);
      node("path", { d: WORD, transform: "translate(" + WORD_OFF[0] + " " + WORD_OFF[1] + ")", style: "fill:" + INK }, m.word);
    }
    m.slide = node("g", {}, svg);
    m.whole = node("g", {}, m.slide);
    function note(body, acc, cid) {
      var g = node("g", {}, m.whole);
      node("path", { d: body, style: "fill:" + INK }, g);
      node("path", { d: acc, "clip-path": "url(#" + cid + ")", "fill-rule": "evenodd", style: "fill:" + LEAF }, g);
      return g;
    }
    m.a = note(A_BODY, A_ACC, id + "a");
    m.b = note(B_BODY, B_ACC, id + "b");
    // split pop: faint glow, thin ring, six sparks
    m.pop = node("g", { "pointer-events": "none", style: "display:none" }, m.slide);
    m.popGlow = node("circle", { cx: CX, cy: CY, style: "fill:" + LEAF }, m.pop);
    m.popRing = node("circle", { cx: CX, cy: CY, style: "fill:none;stroke:" + LEAF }, m.pop);
    m.sparks = [0, 1, 2, 3, 4, 5].map(function (i) { return { a: (i * 60 + 30) * Math.PI / 180, n: node("circle", { style: "fill:" + LEAF }, m.pop) }; });
    return m;
  }
  function render(m, p) {
    m.slide.setAttribute("transform", "translate(" + (p.X || 0) + " 0)");
    m.whole.setAttribute("transform", "rotate(" + p.R + " " + CX + " " + CY + ") translate(" + CX + " " + CY + ") scale(" + p.S + ") translate(" + (-CX) + " " + (-CY) + ")");
    var r = p.R * Math.PI / 180, sin = Math.sin(r), cos = Math.cos(r);
    function place(g, dir, hp, rot, head) {
      var x = dir[0] * p.d + hp * sin, y = dir[1] * p.d + hp * cos;
      g.setAttribute("transform", "translate(" + x + " " + y + ") rotate(" + rot + " " + head[0] + " " + head[1] + ")");
    }
    place(m.a, DIR_A, p.hopA, p.rotA, HEAD_A);
    place(m.b, DIR_B, p.hopB, p.rotB, HEAD_B);
    if (m.word) {
      var half = (190 * Math.abs(cos) + 95 * Math.abs(sin)) * p.S;
      // Same as the motion lab: the word slides out from a fixed start (its right end at the glyph's
      // final right edge) while the clip edge rides on the moving note heads. It shows only once the
      // gliding mark has uncovered it.
      m.wordClip.setAttribute("x", p.X + CX + half + p.tuck);
      m.word.setAttribute("transform", "translate(" + (-(WORD_RIGHT - (CX + 190)) * (1 - p.wordProg)) + " 0)");
    }
  }
  function renderPop(m, x, size) {
    if (x == null || x < 0 || x > 1 || size <= 0) { m.pop.style.display = "none"; return; }
    m.pop.style.display = "";
    var e = E.o3(x), f = 1 - x;
    m.popGlow.setAttribute("r", (30 + 30 * e) * size); m.popGlow.style.opacity = (0.22 * Math.pow(f, 3)).toFixed(3);
    m.popRing.setAttribute("r", (14 + 110 * e) * size); m.popRing.style.strokeWidth = (7 * f * Math.sqrt(size)).toFixed(2);
    m.popRing.style.opacity = (0.75 * Math.pow(f, 1.5)).toFixed(3);
    m.sparks.forEach(function (sp) {
      var dd = (34 + 120 * e) * size;
      sp.n.setAttribute("cx", CX + Math.cos(sp.a) * dd); sp.n.setAttribute("cy", CY + Math.sin(sp.a) * dd);
      sp.n.setAttribute("r", Math.max(0, 6 * f * Math.sqrt(size))); sp.n.style.opacity = f.toFixed(3);
    });
  }

  // ---- Sound (Web Audio, synthesised; one shared context) ----
  var A = null;
  function audio() {
    if (A) { if (A.ctx.state === "suspended") A.ctx.resume(); return A; }
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    var C = new AC(), comp = C.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    var master = C.createGain(); master.connect(comp); comp.connect(C.destination);
    var len = Math.floor(C.sampleRate * 2.4), ir = C.createBuffer(2, len, C.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    var rev = C.createConvolver(); rev.buffer = ir; var revGain = C.createGain(); rev.connect(revGain); revGain.connect(master);
    var nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), nd = nb.getChannelData(0);
    for (var j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
    A = { ctx: C, master: master, rev: rev, revGain: revGain, noise: nb };
    return A;
  }
  function Voice(S) {
    var au = audio(); if (!au) return null;
    var C = au.ctx;
    au.master.gain.value = S.masterVol; au.revGain.gain.value = S.reverb;
    function out(n, pan, send) {
      var p = C.createStereoPanner();
      if (typeof pan === "number") p.pan.value = pan; else p.pan.setValueCurveAtTime(pan.curve, pan.t, pan.dur);
      n.connect(p); p.connect(au.master);
      if (send > 0) { var s = C.createGain(); s.gain.value = send; p.connect(s); s.connect(au.rev); }
    }
    function noise(t) { var s = C.createBufferSource(); s.buffer = au.noise; s.loop = true; s.start(t, Math.random() * 1.5); return s; }
    function now(delay) { return C.currentTime + 0.005 + (delay || 0); }
    function tick(t, hpF, amp, len) {
      var n = noise(t), hp = C.createBiquadFilter(), g = C.createGain();
      hp.type = "highpass"; hp.frequency.value = Math.min(16000, hpF);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp + 0.0001, t + 0.0008); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(hp); hp.connect(g); out(g, 0, 0.06); n.stop(t + len + 0.02);
    }
    function tone(t, f, amp, dec, f2, rampT) {
      var o = C.createOscillator(), g = C.createGain();
      o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (rampT || dec * 0.6));
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp + 0.0001, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); out(g, 0, 0.08); o.start(t); o.stop(t + dec + 0.02);
    }
    return {
      click: function (delay) {
        var t = now(delay), v = S.clickVol, k = S.clickPitch / 440, B = S.clickBright, L = S.clickBody / 1000, g2 = S.clickSnap / 1000;
        if (S.clickStyle === "snap") {
          tick(t, B * 1.4, 0.5 * v, 0.006); tone(t, 3400 * k, 0.22 * v, 0.035); tone(t, 5300 * k, 0.1 * v, 0.02); tone(t, 150 * k, 0.4 * v, L * 0.5, 70 * k);
          if (g2 > 0) { tick(t + g2, B * 1.4, 0.16 * v, 0.005); tone(t + g2, 4100 * k, 0.07 * v, 0.02); }
        } else if (S.clickStyle === "latch") {
          var t2 = t + 0.014; tick(t, B, 0.12 * v, 0.004); tick(t2, B * 0.8, 0.45 * v, 0.008);
          tone(t2, 1900 * k, 0.25 * v, 0.05); tone(t2, 2950 * k, 0.12 * v, 0.035); tone(t2, 95 * k, 0.5 * v, L * 0.8, 55 * k);
        } else if (S.clickStyle === "switch") {
          tick(t, B, 0.4 * v, 0.008); tone(t, 2300 * k, 0.2 * v, 0.03); tone(t, 600 * k, 0.15 * v, 0.025); tone(t, 110 * k, 0.3 * v, L * 0.4, 70 * k);
          var tr = t + Math.max(0.03, g2 * 2); tick(tr, B, 0.2 * v, 0.006); tone(tr, 2000 * k, 0.1 * v, 0.025);
        } else if (S.clickStyle === "pop") {
          tick(t, B, 0.15 * v, 0.004); tone(t, 380 * k, 0.35 * v, Math.max(0.03, L * 0.4), 1700 * k, 0.012); tone(t + 0.004, 2400 * k, 0.08 * v, 0.03);
        } else {
          tick(t, B, 0.55 * v, 0.025); if (g2 > 0) tick(t + g2, B, 0.28 * v, 0.025);
          tone(t, S.clickPitch, 0.35 * v, L, S.clickPitch * 0.34, L * 0.6);
        }
      },
      chime: function (i, delay) {
        var t = now(delay), f = 659.25 * Math.pow(2, (S.chimeKey + (CHORDS[S.chimeChord] || CHORDS.major)[i]) / 12);
        var pan = (i % 2 ? 1 : -1) * S.chimeWidth, v = S.chimeVol, D = S.chimeDecay;
        var parts = [[1, 1, 1, 0], [1, 0.5, 1, S.chimeShimmer], [2, 0.32 * S.chimeGlass, 0.55, 0], [3, 0.12 * S.chimeGlass, 0.3, 0], [4.2, 0.07 * S.chimeGlass, 0.2, 0]];
        parts.forEach(function (pt) {
          if (pt[1] <= 0) return;
          var o = C.createOscillator(), g = C.createGain(), dec = Math.max(0.08, D * pt[2]);
          o.frequency.setValueAtTime(f * pt[0] * 0.985, t); o.frequency.exponentialRampToValueAtTime(f * pt[0], t + 0.04);
          if (pt[3]) o.detune.value = pt[3];
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pt[1] * 0.13 * v + 0.0001, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
          o.connect(g); out(g, pan, S.chimeSpace); o.start(t); o.stop(t + dec + 0.05);
        });
        if (S.chimeBubble > 0) {
          var b = C.createOscillator(), bg = C.createGain();
          b.frequency.setValueAtTime(f * 4, t); b.frequency.exponentialRampToValueAtTime(f * 6, t + 0.06);
          bg.gain.setValueAtTime(0.02 * S.chimeBubble * v + 0.0001, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          b.connect(bg); out(bg, pan, S.chimeSpace * 1.3); b.start(t); b.stop(t + 0.12);
        }
      },
      swish: function (kind, seconds, delay) {
        var t = now(delay), dur = Math.max(0.25, seconds), N = 64, heavy = kind === "heavy";
        var k = heavy ? S.heavyPitch : S.lightPitch, vol = heavy ? S.heavyVol : S.lightVol;
        var f0 = heavy ? 260 : 900, fp = heavy ? 2000 : 4400, fe = heavy ? 420 : 1800, peak = heavy ? 0.42 : 0.2;
        var q = heavy ? S.heavyFocus : S.lightFocus, panW = heavy ? S.heavyWidth : S.lightWidth;
        var env = new Float32Array(N), fc = new Float32Array(N), pc = new Float32Array(N);
        for (var i = 0; i < N; i++) {
          var x = i / (N - 1), sh = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.85)), 2);
          env[i] = Math.max(0.0001, peak * vol * sh);
          fc[i] = Math.min(18000, k * (x < .5 ? f0 + (fp - f0) * E.ioS(x / .5) : fp + (fe - fp) * E.ioS((x - .5) / .5)));
          pc[i] = -panW + 2 * panW * x;
        }
        var n = noise(t), bp = C.createBiquadFilter(), g = C.createGain();
        bp.type = "bandpass"; bp.Q.value = q; bp.frequency.setValueCurveAtTime(fc, t, dur); g.gain.setValueCurveAtTime(env, t, dur);
        n.connect(bp); bp.connect(g); out(g, { curve: pc, t: t, dur: dur }, heavy ? 0.25 : S.lightSpace); n.stop(t + dur + 0.05);
        if (heavy && S.heavyHum > 0) {
          var o = C.createOscillator(), og = C.createGain(), sub = env.map(function (vv) { return Math.max(0.0001, vv * S.heavyHum); });
          o.frequency.setValueAtTime(95 * Math.sqrt(k), t); o.frequency.exponentialRampToValueAtTime(48 * Math.sqrt(k), t + dur);
          og.gain.setValueCurveAtTime(sub, t, dur); o.connect(og); out(og, 0, 0.1); o.start(t); o.stop(t + dur + 0.05);
        }
      }
    };
  }

  // ---- mount ----
  function mount(el, o) {
    if (!el) throw new Error("Spiral motion: mount() needs a container element.");
    o = o || {};
    var mode = o.mode || "reveal";
    var P = Object.assign({}, TIMING, o.timing || {});
    var S = Object.assign({}, SOUND, o.soundDesign || {});
    var loop = o.loop != null ? !!o.loop : mode !== "reveal";
    var speed = o.speed || 1, soundOn = !!o.sound, playing = o.autoplay !== false;
    var reduce = (o.reducedMotion || "auto") === "auto" && window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var m = buildSvg(mode, o.label);
    if (o.colors) { if (o.colors.mark) m.svg.style.setProperty("--spiral-mark", o.colors.mark); if (o.colors.accent) m.svg.style.setProperty("--spiral-accent", o.colors.accent); }
    el.appendChild(m.svg);

    var BEAT = 60 / P.bpm, unitSec = mode === "loader" ? P.loaderBeat : BEAT;
    var startX = (LOCKUP_VB[0] + LOCKUP_VB[2] / 2) - CX;     // reveal starts centred, ends on the lockup
    var T = revealTimes(P), cycle = T.end + P.loopHold;
    var clock = 0, last = null, raf = 0, prevB = null, completed = false, voice = null, destroyed = false;
    var resolveDone; var finished = new Promise(function (r) { resolveDone = r; });

    function pose(b) {
      if (mode === "loader") return loaderPose(b);
      if (mode === "dance") return loopDancePose(b, P);
      var p = revealPose(b, P, startX); p.tuck = P.wordTuck; return p;
    }
    function events() {
      var s0 = T.s0, s1 = T.s1;
      var sec = function (beats) { return beats * BEAT / speed; };
      return [
        [POP_AT, function () { voice.click(); }],
        [2.0, function () { voice.chime(0); }], [2.5, function () { voice.chime(1); }],
        [3.0, function () { voice.chime(2); }], [3.5, function () { voice.chime(3); }],
        [4.0, function () { voice.swish("light", sec(1.6)); }],
        [s0, function () { voice.swish("heavy", sec(s1 - s0)); }]
      ];
    }
    function sounds(b) {
      if (!soundOn || !playing || mode === "loader" || prevB == null) { prevB = b; return; }
      if (b < prevB) prevB = mode === "dance" ? 0 : b;   // dance looped round, or a replay
      if (b - prevB > 0.3) { prevB = b; return; }
      if (!voice) voice = Voice(S);
      if (voice) events().forEach(function (e) { if (e[0] > prevB && e[0] <= b) e[1](); });
      prevB = b;
    }
    function draw() {
      var b = clock / unitSec, fade = 1;
      if (mode === "reveal") {
        if (loop) {
          if (b >= cycle) { clock -= Math.floor(b / cycle) * cycle * unitSec; b = clock / unitSec; }
          fade = Math.max(0, Math.min(1, b / 0.35, (cycle - b) / 0.5));
        } else if (b >= T.end) {
          b = T.end; clock = b * unitSec;
          if (!completed) { completed = true; playing = false; resolveDone(); if (o.onComplete) o.onComplete(); }
        }
      }
      m.svg.style.opacity = fade < 1 ? fade.toFixed(3) : "";
      var p = pose(b); render(m, p);
      renderPop(m, mode === "loader" ? null : ((mode === "dance" ? p.t : b) - POP_AT) / POP_LEN, S.popSize);
      sounds(mode === "dance" ? p.t : b);
    }
    function frame(now) {
      if (destroyed) return;
      if (last != null && playing) clock += (now - last) / 1000 * speed;
      last = now; draw();
      raf = playing ? requestAnimationFrame(frame) : 0;
      if (!raf) last = null;
    }
    function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

    if (reduce) {
      // Reduced motion: no spin or travel. The reveal shows the finished lockup; the others hold still.
      playing = false;
      if (mode === "reveal") { clock = T.end * unitSec; draw(); completed = true; resolveDone(); if (o.onComplete) setTimeout(o.onComplete, 0); }
      else draw();
    } else { draw(); kick(); }

    return {
      play: function () { if (reduce) return; if (mode === "reveal" && completed && !loop) this.replay(); else { playing = true; kick(); } },
      pause: function () { playing = false; },
      replay: function () { if (reduce) return; clock = 0; prevB = null; completed = false; playing = true; kick(); },
      seek: function (beat) { clock = Math.max(0, beat) * unitSec; prevB = null; draw(); },
      setSound: function (on) { soundOn = !!on; if (soundOn) audio(); },
      setSpeed: function (s) { speed = s > 0 ? s : 1; },
      destroy: function () { destroyed = true; if (raf) cancelAnimationFrame(raf); if (m.svg.parentNode) m.svg.parentNode.removeChild(m.svg); },
      finished: finished,
      duration: mode === "reveal" ? T.end * BEAT : mode === "dance" ? (T.end + DANCE_REST) * BEAT : 2 * P.loaderBeat,
      element: m.svg
    };
  }

  // ---- Components: callable as React components, or .mount() without React ----
  function component(mode, displayName) {
    function C(props) {
      var R = window.React;
      if (!R) throw new Error("Spiral." + displayName + " as a component needs React; use Spiral." + displayName + ".mount(el, options) otherwise.");
      var ref = R.useRef(null), ctl = R.useRef(null);
      R.useEffect(function () {
        var opts = Object.assign({}, props, { mode: mode });
        ctl.current = mount(ref.current, opts);
        if (props.controllerRef) props.controllerRef.current = ctl.current;
        return function () { ctl.current && ctl.current.destroy(); };
      }, []);
      R.useEffect(function () { if (ctl.current) ctl.current.setSound(!!props.sound); }, [props.sound]);
      var style = Object.assign({ width: props.size != null ? props.size : "100%" }, props.style || {});
      return R.createElement("div", { ref: ref, className: props.className, style: style });
    }
    C.displayName = displayName;
    C.mount = function (el, opts) { return mount(el, Object.assign({}, opts || {}, { mode: mode })); };
    return C;
  }

  var ns = window.Spiral = window.Spiral || {};
  ns.LogoReveal = component("reveal", "LogoReveal");
  ns.LogoDance = component("dance", "LogoDance");
  ns.LogoLoader = component("loader", "LogoLoader");
  ns.motion = { mount: mount, timing: TIMING, sound: SOUND };
})();
