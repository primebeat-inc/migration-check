// 判定の規則。利用者のブラウザでも、サーバーでも、手元のコマンドでも同じものが動く

// JPCERT-AT-2026-0033（2026-10-22）が示した修正版。8.2 以前は注意喚起の対象の書き方を確かめていない
const PHP_FIXED = { "8.5": "8.5.12", "8.4": "8.4.27", "8.3": "8.3.36" };

function versionAtLeast(v, min) {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

export function phpAdvice(version) {
  const branch = version.split(".").slice(0, 2).join(".");
  const fixed = PHP_FIXED[branch];
  if (!fixed) return "JPCERT-AT-2026-0033 の対象かを確かめる";
  return versionAtLeast(version, fixed)
    ? `JPCERT-AT-2026-0033 の修正版（${fixed}）以上`
    : `JPCERT-AT-2026-0033 の修正版（${fixed}）より古い。更新と侵害の有無の調査が勧められている`;
}

export function verdict({ domain, tld, dnsInfo, rdap, mail, site, admin }) {
  const mailMove = mail.kind === "rental" || mail.kind === "same_server" ? true : mail.kind === "unknown" || mail.kind === "gateway" ? null : false;
  // サイトを読めなくても、メールの判定と相談の入口は残す
  if (!site.reachable) {
    const steps = ["www を付けた URL でもう一度試す。サイトがあるのに届かないときは、作りを確かめる必要がある"];
    if (mailMove === true) steps.push("メールはサーバーにある。サーバーを解約する前にメールを Google Workspace などへ移す");
    return { type: null, typeLabel: "サイトに届かず判定できない", consult: true, mailMove, steps, warnings: [site.error] };
  }
  const type = !site.readable ? null : site.platform ? "C" : site.cms ? "B" : site.dynamicHints.length ? "D" : "A";
  const exposedAdmin = admin.filter((a) => a.exposed);
  const warnings = [];
  if (exposedAdmin.length) warnings.push(`管理画面がインターネットから開ける: ${exposedAdmin.map((a) => a.path).join("、")}`);
  if (site.php) warnings.push(`PHP の版が外から見える: ${site.php}。${phpAdvice(site.php)}`);
  if (!dnsInfo.dmarc) warnings.push("DMARC の設定が無い（なりすましメールを受け手が見分けにくい）");
  if (dnsInfo.onCloudflare) warnings.push("DNS はすでに Cloudflare にある");
  if (/cloudflare/i.test(rdap.registrar ?? "")) warnings.push("ドメインはすでに Cloudflare で登録されている");

  const steps = [];
  if (type === "C") {
    steps.push(`サイトは ${site.platform} が動かしている。Cloudflare に移す必要は薄く、サービスによってはネームサーバーを変えられない`);
    if (mailMove === true) steps.push("メールはレンタルサーバーにある。サーバーを解約するなら、その前にメールを Google Workspace などへ移す");
    if (mailMove === null) steps.push("メールの置き場所を今の事業者に確かめる");
  } else {
    if (!dnsInfo.onCloudflare) {
      steps.push(`Cloudflare のアカウントを作り、${domain} を追加する。今の DNS の設定が読み込まれる`);
      steps.push("読み込まれた DNS の設定を今の設定と見比べる。とくに MX と TXT（メールの設定）を落とさない");
    }
    if (dnsInfo.onCloudflare && !site.behindCloudflare) steps.push("DNS は Cloudflare にあるが、サイトの通信は Cloudflare を通っていない。DNS の設定でサイトの行をプロキシ（オレンジの雲）にする");
    if (mailMove === true) steps.push("サーバーにあるメールを Google Workspace などへ移す。サーバーを解約する前に終える");
    if (mailMove === null) steps.push("メールの置き場所を今の事業者に確かめる。サーバーにあるなら解約の前に移す");
    if (site.cms === "EC-CUBE") steps.push("EC サイトは静的にできない。サーバーを残して Cloudflare の後ろに置き、管理画面は Cloudflare Access の後ろに置く");
    else if (type === "B") steps.push(`${site.cms} の公開ページを静的に書き出して Cloudflare Pages に置くか、サーバーを残して Cloudflare の後ろに置くかを決める。管理画面は Cloudflare Access の後ろに置く`);
    else if (type === "D") steps.push("サーバーで動くプログラムがある。静的にできるか、サーバーを残して Cloudflare の後ろに置くかは、中を見てから決める");
    if (!dnsInfo.onCloudflare) steps.push(`今の事業者（DNS: ${dnsInfo.nsProvider}）の管理画面で、ネームサーバーを Cloudflare が示す2つに変える。反映まで最大で1日ほど`);
    if (dnsInfo.registrar.status === "可" && !/cloudflare/i.test(rdap.registrar ?? "")) {
      const lockNote = rdap.transferLocked ? "今はロックがかかっている。" : "";
      steps.push(`（任意）ドメインも移すなら: ${lockNote}今の事業者でロックを外し、認証コードを取り、Cloudflare で移管を申し込む。旧事業者の承認メールに対応する。多くは5営業日以内。登録や登録者情報の変更から60日以内は移管できない`);
    }
    if (site.cms !== "EC-CUBE" && (mailMove !== false || type === "B" || type === "D")) steps.push("サイトとメールが新しい置き場所で動くのを確かめてから、レンタルサーバーを解約する");
  }

  const alreadyMoved = dnsInfo.onCloudflare && site.behindCloudflare;
  const consult = !alreadyMoved && (type !== "C" || mailMove === true);
  const typeLabel = {
    A: "型A: 静的サイトの可能性",
    B: `型B: ${site.cms}`,
    C: `型C: サイト作成サービス（${site.platform}）`,
    D: `型を確かめる必要がある: サーバーで動くプログラムがある（${site.dynamicHints.join("、")}）`,
  }[type] ?? `型を判定できない: ${site.unreadableReason}`;
  const label = alreadyMoved && type ? `${typeLabel}（すでに Cloudflare に移っている）` : typeLabel;

  return { type, typeLabel: label, alreadyMoved, consult, domainAction: dnsInfo.registrar.note, mailMove, steps, warnings };
}

// DNS の結果とサイトの結果を、画面と手元のコマンドで同じ形にまとめる
export function assemble(input, { host, domain, tld, dnsInfo, rdap, mail }, { site, admin }) {
  return {
    input,
    host,
    domain,
    tld,
    checkedAt: new Date().toISOString(),
    domainInfo: { ...dnsInfo, rdap, isJp: tld === "jp" },
    mail: { ...mail, mx: dnsInfo.mx, spf: dnsInfo.spf, dmarc: dnsInfo.dmarc },
    site,
    admin,
    verdict: verdict({ domain, tld, dnsInfo, rdap, mail, site, admin }),
  };
}
