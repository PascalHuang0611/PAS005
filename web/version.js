// 全站共用版本號,升版只改這裡
const APP_VERSION = '0.96';

document.addEventListener('DOMContentLoaded', () => {
    const versionTag = document.createElement('div');
    versionTag.id = 'app-version';
    versionTag.textContent = `v${APP_VERSION}`;
    document.body.appendChild(versionTag);
});
