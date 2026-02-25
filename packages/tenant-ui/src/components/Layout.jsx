import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import s from './Layout.module.scss';

function Layout() {
  return (
    <div className={s.wrapper}>
      <Sidebar />
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
