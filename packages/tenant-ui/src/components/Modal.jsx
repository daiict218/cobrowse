import { useEffect, useRef, useCallback } from 'react';
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

  /* Escape key — sync React state instead of letting browser close natively */
  const handleCancel = useCallback((e) => {
    e.preventDefault();
    onClose();
  }, [onClose]);

  /* Click on ::backdrop — dialog element is the target when clicking outside the box */
  const handleClick = useCallback((e) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleClick}
      className={s.dialog}
    >
      <div className={s.header}>
        <h3 className={s.title}>{title}</h3>
        <button onClick={onClose} className={s.closeBtn} title="Close">
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
