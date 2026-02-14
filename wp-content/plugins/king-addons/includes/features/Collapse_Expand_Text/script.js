/**
 * Collapse & Expand Text Feature
 * King Addons for Elementor
 */

(function($) {
    'use strict';

    class KingAddonsCollapseExpandText {
        constructor() {
            this.init();
        }

        init() {
            // Initialize on document ready
            $(document).ready(() => {
                this.initElements();
            });

            // Re-initialize when Elementor frontend loads (for preview mode)
            if (typeof elementor !== 'undefined') {
                elementor.hooks.addAction('frontend/element_ready/global', () => {
                    this.initElements();
                });
            }

            // Re-initialize when widgets are loaded in preview
            $(window).on('elementor/frontend/init', () => {
                elementorFrontend.hooks.addAction('frontend/element_ready/global', () => {
                    this.initElements();
                });
            });
        }

        initElements() {
            // Find all elements with collapse/expand enabled
            $('.kng-collapse-expand-yes').each((index, element) => {
                this.setupCollapseExpand($(element));
            });
        }

        setupCollapseExpand($element) {
            // Skip if already initialized
            if ($element.data('kng-collapse-initialized')) {
                return;
            }

            // Check if element has collapse/expand enabled
            if (!$element.hasClass('kng-collapse-expand-yes')) {
                return;
            }

            // Find the main text content
            let $textContent = this.findTextContent($element);
            
            if (!$textContent || $textContent.length === 0) {
                return;
            }

            // Get settings from data attributes
            const collapsedHeight = parseInt($element.data('kng-collapse-height')) || 80;
            const showMoreText = $element.data('kng-collapse-show-more') || 'Read more';
            const showLessText = $element.data('kng-collapse-show-less') || 'Read less';
            const animationDuration = parseInt($element.data('kng-collapse-duration')) || 300;
            const buttonPosition = $element.data('kng-collapse-position') || 'right';

            // Check if text needs collapsing
            if (!this.needsCollapsing($textContent, collapsedHeight)) {
                return;
            }

            // Mark as initialized
            $element.data('kng-collapse-initialized', true);

            // Wrap content and add button
            this.wrapContent($textContent, $element, showMoreText, showLessText, buttonPosition);

            // Set initial state
            this.setCollapsedState($element);

            // Bind button click
            this.bindButtonClick($element, animationDuration);
        }

        findTextContent($element) {
            // For styled text builder
            if ($element.find('.king-addons-styled-text-builder-items').length) {
                return $element.find('.king-addons-styled-text-builder-items');
            }

            // For default text widget
            if ($element.find('.elementor-text-editor').length) {
                return $element.find('.elementor-text-editor');
            }

            // For heading widget
            if ($element.find('.elementor-heading-title').length) {
                return $element.find('.elementor-heading-title');
            }

            // For other text content
            if ($element.find('p, h1, h2, h3, h4, h5, h6, div').length) {
                return $element.find('p, h1, h2, h3, h4, h5, h6, div').first();
            }

            return null;
        }

        needsCollapsing($content, maxHeight) {
            // Create a temporary clone to measure
            const $clone = $content.clone();
            $clone.css({
                'position': 'absolute',
                'top': '-9999px',
                'left': '-9999px',
                'width': $content.width() || 'auto',
                'visibility': 'hidden'
            });
            
            $('body').append($clone);
            
            const contentHeight = $clone.height();
            
            $clone.remove();
            
            return contentHeight > maxHeight;
        }

        wrapContent($content, $element, showMoreText, showLessText, buttonPosition) {
            // Wrap the content
            $content.wrap('<div class="kng-collapse-expand-content collapsed"></div>');
            
            // Add button wrapper and button
            const buttonHtml = `
                <div class="kng-collapse-expand-button-wrapper">
                    <button class="kng-collapse-expand-button" 
                            data-show-more-text="${showMoreText}" 
                            data-show-less-text="${showLessText}"
                            aria-expanded="false">
                        ${showMoreText}
                    </button>
                </div>
            `;
            
            $element.find('.kng-collapse-expand-content').after(buttonHtml);
        }

        setCollapsedState($element) {
            const $content = $element.find('.kng-collapse-expand-content');
            const $button = $element.find('.kng-collapse-expand-button');
            
            $content.addClass('collapsed').removeClass('expanded');
            $button.attr('aria-expanded', 'false');
            $button.text($button.data('show-more-text'));
        }

        setExpandedState($element) {
            const $content = $element.find('.kng-collapse-expand-content');
            const $button = $element.find('.kng-collapse-expand-button');
            
            $content.addClass('expanded').removeClass('collapsed');
            $button.attr('aria-expanded', 'true');
            $button.text($button.data('show-less-text'));
        }

        bindButtonClick($element, animationDuration) {
            const $button = $element.find('.kng-collapse-expand-button');
            const $content = $element.find('.kng-collapse-expand-content');
            
            $button.on('click', (e) => {
                e.preventDefault();
                
                if ($content.hasClass('collapsed')) {
                    // Expand
                    this.setExpandedState($element);
                } else {
                    // Collapse
                    this.setCollapsedState($element);
                    
                    // Scroll to element top if needed
                    this.scrollToElementIfNeeded($element);
                }
            });
        }

        scrollToElementIfNeeded($element) {
            const elementTop = $element.offset().top;
            const viewportTop = $(window).scrollTop();
            const elementHeight = $element.height();
            
            // If element top is above viewport, scroll to it
            if (elementTop < viewportTop) {
                $('html, body').animate({
                    scrollTop: elementTop - 20
                }, 300);
            }
        }


    }

    // Initialize the collapse/expand functionality
    new KingAddonsCollapseExpandText();

})(jQuery);
