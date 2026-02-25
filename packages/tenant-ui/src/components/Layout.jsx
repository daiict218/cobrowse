import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import s from './Layout.module.scss';

const STORAGE_KEY = 'sb';

function Layout() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1'
  );

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  return (
    <div className={s.wrapper}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className={`${s.main}${collapsed ? ` ${s.mainCollapsed}` : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
