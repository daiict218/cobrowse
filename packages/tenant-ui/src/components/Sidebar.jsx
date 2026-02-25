import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import s from './Sidebar.module.scss';

const navItems = [
  { to: '/portal',          label: 'Dashboard',  icon: '\u2302' },
  { to: '/portal/tenants',  label: 'Tenants',    icon: '\u2630' },
];

function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/portal/login');
  };

  const sidebarClass = `${s.sidebar}${collapsed ? ` ${s.sidebarCollapsed}` : ''}`;

  return (
    <aside className={sidebarClass}>
      <div className={s.brand}>
        <div className={s.brandName}>{collapsed ? 'CB' : 'CoBrowse'}</div>
        <div className={s.brandSub}>Vendor Portal</div>
      </div>

      <nav className={s.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/portal'}
            className={({ isActive }) =>
              `${s.navLink}${isActive ? ` ${s.navLinkActive}` : ''}`
            }
            title={collapsed ? item.label : undefined}
          >
            <span className={s.navIcon}>{item.icon}</span>
            <span className={s.navLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button
        className={s.toggleBtn}
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '\u00BB' : '\u00AB'}
      </button>

      <div className={s.footer}>
        <div className={s.userName}>{user?.name}</div>
        <div className={s.vendorName}>{user?.vendorName}</div>
        <button
          onClick={handleLogout}
          className={s.logoutBtn}
          title={collapsed ? 'Sign out' : undefined}
        >
          {collapsed ? '\u23FB' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
