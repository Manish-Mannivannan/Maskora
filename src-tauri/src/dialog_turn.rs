//! One native file dialog at a time (architecture §7.1, §11.2).
//!
//! Every command that opens a dialog takes the turn first and holds it until
//! the dialog closes. A second request while one is open is refused at once
//! with `dialogBusy`, so a frontend bypassing its own buttons cannot stack
//! dialogs or flood the user with them.

use std::sync::atomic::{AtomicBool, Ordering};

static OPEN: AtomicBool = AtomicBool::new(false);

/// Held while a dialog is open; dropping it frees the turn.
#[must_use]
pub struct Turn;

impl Drop for Turn {
    fn drop(&mut self) {
        OPEN.store(false, Ordering::SeqCst);
    }
}

/// The turn, or None while another dialog is open.
pub fn take() -> Option<Turn> {
    OPEN.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| Turn)
}

pub const BUSY: &str = "Another file dialog is already open.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_dialog_waits_for_the_first_to_close() {
        let first = take().expect("free at first");
        assert!(take().is_none(), "a second dialog while one is open");
        drop(first);
        assert!(take().is_some(), "free again once closed");
    }
}
