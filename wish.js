
// Localstorage 
let cart=JSON.parse(localStorage.getItem('cart'))||[]
let wish=JSON.parse(localStorage.getItem('wish'))||[]
let Cart = JSON.parse(localStorage.getItem("cart")) || [];




// Fetching the data

let container=document.getElementById("container")

display(wish)
function display(wish){
    container.innerHTML=""
   
    wish.forEach((el,ind) => {

        // Creating 
        let box=document.createElement("div")
        let box2=document.createElement("div")
        let box3=document.createElement("div")
        let img=document.createElement("img")
        let title=document.createElement("h2")
        let price=document.createElement("h3")
        let btn=document.createElement("button")

        // Assigning Data
        img.src=el.image
        title.innerText=el.title
        price.innerText=`₹ ${el.price}`
        btn.innerText="Add to Cart"

        // Clssess
        box.className="box";
        box3.id="wish";

        //Event Listner

        btn.addEventListener("click",()=>{
            cart.push(el)
            localStorage.setItem("cart",JSON.stringify(cart))
            Swal.fire({
              position: 'center',
              icon: 'success',
              title: 'Product Added To Cart',
              showConfirmButton: false,
              timer: 1500
            })
        })

        // Appending to Main 
        box2.append(img)
        box3.append(btn)
        box.append(box2,title,price,box3)
        container.append(box)
    });
}
let Total=document.getElementById("cartTotal")
Total.innerText=Cart.length


let user = document.querySelector(".signin");
user.onclick = () => {
  location.href = "./login.html";
};
let order = document.querySelector(".orders");
order.onclick = () => {
  location.href = "./wish.html";
};

let bag = document.querySelector(".bag");
bag.onclick = () => {
  location.href = "./cart.html";
};
