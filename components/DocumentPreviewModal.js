import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function DocumentPreviewModal({ files = [], isOpen, onClose }) {
  const [idx, setIdx] = useState(0);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={files[idx]}
              alt={`document ${idx + 1}`}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />

            {/* nút đóng */}
            <button
              onClick={onClose}
              className="absolute top-2 right-2 text-white text-3xl"
            >
              &times;
            </button>

            {/* prev/next */}
            {files.length > 1 && (
              <>
                <button
                  onClick={() => setIdx((idx + files.length - 1) % files.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white text-4xl select-none"
                >
                  ‹
                </button>
                <button
                  onClick={() => setIdx((idx + 1) % files.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white text-4xl select-none"
                >
                  ›
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
