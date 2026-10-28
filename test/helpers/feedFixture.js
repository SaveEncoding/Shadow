/**
 * فیکسچر HTML شبیه پیش‌نمایش واقعی `t.me/s/<channel>`
 * (ساختار واقعی: هر پست یک `data-post` و یک بلوک دارد)
 */
export function feedPage(posts) {
	const blocks = posts
		.map((post) => {
			const text = post.html
				? `<div class="tgme_widget_message_text js-message_text" dir="auto">${post.html}</div>`
				: '';
			const media = (post.media ?? [])
				.map((m) => {
					if (m.kind === 'photo') {
						return `<a class="tgme_widget_message_photo_wrap blured" style="width:800px;background-image:url('${m.url}')" href="https://t.me/${post.channel}/${post.id}"><div class="tgme_widget_message_photo" style="padding-top:50%;background-image:url('${m.url}')"></div></a>`;
					}
					return `<a class="tgme_widget_message_video_player js-message_video_player blured" href="https://t.me/${post.channel}/${post.id}"><i class="tgme_widget_message_video_thumb" style="background-image:url('${m.thumb ?? m.url}')"></i><div class="tgme_widget_message_video_wrap"><video src="${m.url}" class="tgme_widget_message_video" preload="metadata"></video></div></a>`;
				})
				.join('');
			const extra = post.extraHtml ?? '';

			return `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${post.channel}/${post.id}" data-view="eyJ9">
    <div class="tgme_widget_message_bubble">
      ${media}
      ${text}
      ${extra}
      <div class="tgme_widget_message_footer compact js-message_footer">
        <a class="tgme_widget_message_date" href="https://t.me/${post.channel}/${post.id}"><time datetime="2026-10-24T12:00:00+00:00" class="time">15:30</time></a>
      </div>
    </div>
  </div>
</div>`;
		})
		.join('\n');

	return `<!DOCTYPE html><html><head><title>Channel</title></head><body>
<div class="tgme_page_wrap"><div class="tgme_channel_info">
  <div class="tgme_channel_info_header_title"><span dir="auto">کانال نمونه</span></div>
</div>
<section class="tgme_channel_history js-message_history">
${blocks}
</section></div></body></html>`;
}

/** صفحه‌ای که کانال خصوصی است / وجود ندارد */
export const EMPTY_PAGE = `<!DOCTYPE html><html><body><div class="tgme_page"><div class="tgme_page_title">Telegram: Contact @nope</div></div></body></html>`;
