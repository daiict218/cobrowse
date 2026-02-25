import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import s from './Sidebar.module.scss';

const navItems = [
  { to: '/portal',          label: 'Dashboard',  icon: '\u2302' },
  { to: '/portal/tenants',  label: 'Tenants',    icon: '\u2630' },
];

function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/portal/login');
  };

  return (
    <aside className={s.sidebar}>
      <div className={s.brand}>
        <div className={s.brandName}>CoBrowse</div>
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
          >
            <span className={s.navIcon}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className={s.footer}>
        <div className={s.userName}>{user?.name}</div>
        <div className={s.vendorName}>{user?.vendorName}</div>
        <button onClick={handleLogout} className={s.logoutBtn}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
