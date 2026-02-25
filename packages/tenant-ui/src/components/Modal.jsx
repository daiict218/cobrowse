import { useEffect, useRef } from 'react';
import s from './Modal.module.scss';

function Modal({ open, onClose, title, children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog ref={dialogRef} onClose={onClose} className={s.dialog}>
      <div className={s.header}>
        <h3 className={s.title}>{title}</h3>
        <button onClick={onClose} className={s.closeBtn}>
          {'\u2715'}
        </button>
      </div>
      <div className={s.body}>
        {children}
      </div>
    </dialog>
  );
}

export default Modal;
