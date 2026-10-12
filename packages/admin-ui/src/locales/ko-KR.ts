import component from './ko-KR/component';
import globalHeader from './ko-KR/globalHeader';
import menu from './ko-KR/menu';
import network from './ko-KR/network';
import pages from './ko-KR/pages';
import settingDrawer from './ko-KR/settingDrawer';
import settings from './ko-KR/settings';

export default {
  'navBar.lang': '언어',
  'layout.user.link.help': '도움말',
  'layout.user.link.privacy': '개인정보',
  'layout.user.link.terms': '이용약관',
  'app.preview.down.block': '이 페이지를 로컬 프로젝트에 다운로드하세요',
  ...globalHeader,
  ...menu,
  ...settingDrawer,
  ...settings,
  ...network,
  ...component,
  ...pages,
};
