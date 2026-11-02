const vietnameseProductNames = {
  "Vibrant Spring Basket": "Giỏ hoa sắc xuân",
  "Floral Jewels Arrangement": "Bó hoa sắc màu",
  "Lovely Lavender Bouquet": "Bó hoa oải hương",
  "Rising Star": "Ngôi sao rực rỡ",
  "Rainbows of Glimmer": "Cầu vồng lấp lánh",
  "Basket Of Wishes": "Giỏ hoa điều ước",
  "A Dash of Vibrance": "Sắc màu tươi mới",
  "Tons of Love": "Ngàn lời yêu thương",
  "A Touch of Softness": "Dịu dàng tinh khôi",
  "I'll Fly Away": "Bay cùng cánh hoa",
  "Assorted Sunshine Gerbers": "Bó hoa đồng tiền rực rỡ",
  "French Country Bouquet": "Bó hoa đồng nội nước Pháp",
  "Forever Yours Bouquet": "Bó hoa mãi bên nhau",
  "Spring Dazzler": "Sắc xuân tỏa sáng",
  "An Early Spring": "Hương xuân dịu nhẹ",
  "Timeless Affections": "Tình cảm vẹn nguyên",
  "Fashionista Chic": "Phong cách thời thượng",
  "Make Me Blush": "Nàng thơ e ấp",
  "Mystical Allure": "Sức hút huyền bí",
  "I Dream of Roses": "Giấc mơ hoa hồng",
  "Purity Bouquet": "Bó hoa tinh khôi",
  "Colorful Birthday Bliss": "Sinh nhật sắc màu",
  "A Windfall of Orchids": "Rực rỡ hoa lan",
  "Emerging Sunset Passions": "Sắc nắng hoàng hôn",
  "Tulip Reverie": "Khúc ca hoa tulip",
  "Hydrangea Cloud": "Mây xanh cẩm tú cầu",
  "Peony Blush": "Sắc hồng mẫu đơn",
  "Carnation Grace": "Dịu dàng cẩm chướng",
  "Sunflower Daylight": "Nắng vàng hướng dương",
  "Baby's Breath Serenade": "Mây hoa bi dịu dàng",
  "Iris Twilight": "Ánh tím diên vĩ",
  "Gerbera Sunshine": "Nắng tươi đồng tiền",
  "White Lily Tribute": "Lily trắng tưởng nhớ",
  "Peace Lily Plant": "Cây lan ý thanh lọc",
  "Fresh Fruit Gift Basket": "Giỏ trái cây tươi",
  "Chocolate Gift Box": "Hộp quà sô-cô-la",
  "Same-Day Gerbera Bouquet": "Bó đồng tiền giao trong ngày",
  "Spring Bouquet Special": "Bó hoa xuân ưu đãi"
};

function getVietnameseProductName(name) {
  return vietnameseProductNames[name] || name;
}

// Shows the description the admin wrote, whatever its language; only an empty one gets the
// generic sentence.
function getVietnameseProductDescription(description) {
  const text = String(description || "").trim();
  return text || "Mẫu hoa tươi được tuyển chọn và sắp xếp chỉn chu, phù hợp làm quà tặng trong những dịp đáng nhớ.";
}
