import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Loader2 } from "lucide-react";
import { useContactStore } from "@/stores/contactStore";

interface AddFriendDialogProps {
  onClose: () => void;
}

export function AddFriendDialog({ onClose }: AddFriendDialogProps) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const addFriend = useContactStore((s) => s.addFriend);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await addFriend(username.trim());
      setSuccess(true);
      setTimeout(onClose, 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="dialog-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="dialog"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dialog__header">
            <div>
              <h3 className="dialog__title">Add Friend</h3>
              <p className="dialog__subtitle">Enter their username to connect</p>
            </div>
            <button onClick={onClose} className="icon-btn">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              placeholder="Username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              className="input"
            />

            {error && (
              <motion.p
                className="dialog__alert dialog__alert--error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {error}
              </motion.p>
            )}

            {success && (
              <motion.p
                className="dialog__alert dialog__alert--success"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                ✓ Friend added successfully!
              </motion.p>
            )}

            <motion.button
              type="submit"
              disabled={loading || !username.trim() || success}
              className="btn-primary mt-4"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <UserPlus size={15} />
              )}
              {loading ? "Adding..." : success ? "Added!" : "Add Friend"}
            </motion.button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
