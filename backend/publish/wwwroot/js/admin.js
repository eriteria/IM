// IM Admin Panel - Metronic 8 Inspired JavaScript

document.addEventListener('DOMContentLoaded', function() {
    initializeSidebar();
    initializeAlerts();
});

// ============================
// SIDEBAR MANAGEMENT
// ============================

function initializeSidebar() {
    const asideToggle = document.getElementById('kt_aside_toggle');
    const aside = document.getElementById('kt_aside');
    const asideOverlay = document.getElementById('kt_aside_overlay');
    const body = document.body;

    if (asideToggle && aside) {
        // Toggle sidebar on button click
        asideToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebar();
        });

        // Close sidebar when clicking overlay
        if (asideOverlay) {
            asideOverlay.addEventListener('click', function() {
                closeSidebar();
            });
        }

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', function(e) {
            if (window.innerWidth < 992) {
                if (!aside.contains(e.target) && !asideToggle.contains(e.target)) {
                    closeSidebar();
                }
            }
        });

        // Handle window resize
        window.addEventListener('resize', function() {
            if (window.innerWidth >= 992) {
                closeSidebar();
            }
        });

        // Handle escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeSidebar();
            }
        });
    }
}

function toggleSidebar() {
    const aside = document.getElementById('kt_aside');
    const body = document.body;

    if (aside) {
        aside.classList.toggle('show');
        body.classList.toggle('aside-open');
    }
}

function closeSidebar() {
    const aside = document.getElementById('kt_aside');
    const body = document.body;

    if (aside) {
        aside.classList.remove('show');
        body.classList.remove('aside-open');
    }
}

// ============================
// ALERTS
// ============================

function initializeAlerts() {
    // Auto-dismiss alerts after 5 seconds
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        setTimeout(() => {
            fadeOut(alert);
        }, 5000);
    });
}

function fadeOut(element) {
    element.style.transition = 'opacity 0.3s ease';
    element.style.opacity = '0';
    setTimeout(() => {
        element.remove();
    }, 300);
}

// ============================
// TOAST NOTIFICATIONS
// ============================

function showToast(message, type = 'success') {
    const toastContainer = document.querySelector('.toast-container') || createToastContainer();

    const iconMap = {
        success: 'bi-check-circle-fill',
        error: 'bi-exclamation-triangle-fill',
        warning: 'bi-exclamation-circle-fill',
        info: 'bi-info-circle-fill'
    };

    const colorMap = {
        success: 'success',
        error: 'danger',
        warning: 'warning',
        info: 'info'
    };

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${colorMap[type] || 'success'}`;
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="bi ${iconMap[type] || iconMap.success}"></i>
        </div>
        <div class="toast-content">
            <span class="toast-message">${message}</span>
        </div>
        <button type="button" class="toast-close" onclick="this.parentElement.remove()">
            <i class="bi bi-x"></i>
        </button>
    `;

    toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto dismiss after 4 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;
    document.body.appendChild(container);
    return container;
}

// ============================
// CONFIRM DIALOG
// ============================

function confirmAction(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1050;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
        `;
        modal.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="width: 60px; height: 60px; background: #FFF5F8; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
                    <i class="bi bi-question-lg" style="font-size: 28px; color: #F1416C;"></i>
                </div>
                <h3 style="font-size: 18px; font-weight: 600; color: #181C32; margin-bottom: 8px;">${title}</h3>
                <p style="color: #7E8299; font-size: 14px;">${message}</p>
            </div>
            <div style="display: flex; gap: 12px;">
                <button class="btn-cancel" style="flex: 1; padding: 12px; border: 0; border-radius: 8px; background: #EFF2F5; color: #7E8299; font-weight: 600; cursor: pointer;">Cancel</button>
                <button class="btn-confirm" style="flex: 1; padding: 12px; border: 0; border-radius: 8px; background: #F1416C; color: white; font-weight: 600; cursor: pointer;">Confirm</button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Handle clicks
        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            backdrop.remove();
            resolve(false);
        });

        modal.querySelector('.btn-confirm').addEventListener('click', () => {
            backdrop.remove();
            resolve(true);
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
                resolve(false);
            }
        });

        // Close on escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                backdrop.remove();
                resolve(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

// ============================
// UTILITY FUNCTIONS
// ============================

// Format large numbers
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Relative time
function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hours ago';
    if (diff < 604800) return Math.floor(diff / 86400) + ' days ago';
    return formatDate(dateString);
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================
// API HELPERS
// ============================

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'An error occurred' }));
            throw new Error(error.message || 'Request failed');
        }

        return response.json();
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

// ============================
// TABLE HELPERS
// ============================

// Filter table by search term
function filterTable(searchInput, tableId) {
    const filter = searchInput.value.toLowerCase();
    const table = document.getElementById(tableId);
    if (!table) return;

    const rows = table.getElementsByTagName('tr');

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.getElementsByTagName('td');
        let found = false;

        for (let j = 0; j < cells.length; j++) {
            if (cells[j].textContent.toLowerCase().indexOf(filter) > -1) {
                found = true;
                break;
            }
        }

        row.style.display = found ? '' : 'none';
    }
}

// Export table to CSV
function exportTableToCSV(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    const csv = [];

    rows.forEach(row => {
        const cols = row.querySelectorAll('td, th');
        const rowData = [];
        cols.forEach(col => {
            rowData.push('"' + col.textContent.replace(/"/g, '""').trim() + '"');
        });
        csv.push(rowData.join(','));
    });

    const csvContent = csv.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ============================
// LOADING STATE
// ============================

function setLoading(element, loading) {
    if (!element) return;

    if (loading) {
        element.disabled = true;
        element.dataset.originalText = element.innerHTML;
        element.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Loading...
        `;
    } else {
        element.disabled = false;
        element.innerHTML = element.dataset.originalText || element.innerHTML;
    }
}

// ============================
// FILE UPLOAD PREVIEW
// ============================

function previewFile(input, previewElement) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewElement.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}
