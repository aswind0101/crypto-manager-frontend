import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function DocumentPreviewModal({ files = [], isOpen, onClose }) {
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(1);

  // Reset khi mở lại
  useEffect(() => {
    if (isOpen) {
      setIdx(0);
      setZoom(1);
    }
  }, [isOpen]);

  // Bắt Esc để đóng
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const zoomIn  = () => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)));

  return (
    <AnimatePresence>
      {isOpen && (
        // Backdrop
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Card container */}
          <motion.div
            className="relative bg-gradient-to-br from-[#2f374a] via-[#1C1F26] to-[#0b0f17] 
            shadow-[2px_2px_4px_#0b0f17,_-2px_-2px_4px_#1e2631]
            rounded-2xl overflow-auto"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Zoom controls */}
            <div className="absolute top-1 left-4 z-10 flex space-x-2">
              <button onClick={zoomOut} className="p-1 rounded text-white text-lg">–</button>
              <button onClick={zoomIn}  className=" p-1 rounded text-white text-lg">+</button>
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-1 right-4 z-10 p-1 rounded-full text-white text-2xl"
            >
              &times;
            </button>

            {/* Prev/Next */}
            {files.length > 1 && (
              <>
                <button
                  onClick={() => setIdx(i => (i - 1 + files.length) % files.length)}
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 bg-black bg-opacity-50 p-1 rounded text-white text-3xl"
                >‹</button>
                <button
                  onClick={() => setIdx(i => (i + 1) % files.length)}
                  className="absolute right-4 top-1/2 z-10 -translate-y-1/2 bg-black bg-opacity-50 p-1 rounded text-white text-3xl"
                >›</button>
              </>
            )}

            {/* Image wrapper: zoomable & scrollable */}
            <div
              className="relative"
              style={{
                width:  `${90 * zoom}vw`,
                height: `${90 * zoom}vh`,
              }}
            >
              <img
                src={files[idx]}
                alt={`document ${idx + 1}`}
                className="absolute top-0 left-0 w-full h-full object-contain rounded-lg"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
