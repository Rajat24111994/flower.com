
let API="./flower.json"

// Localstorage 
let cart=JSON.parse(localStorage.getItem('cart'))||[]
let wish=JSON.parse(localStorage.getItem('wish'))||[]


// Fetching the data
fetch(API)
.then((request)=>request.json())
.then((data)=>{
    console.log(data.flower)
    display(data.flower)
    
    })
let container=document.getElementById("container")


function display(data){
    container.innerHTML=""
   
    data.forEach((el,ind) => {

        // Creating 
        let box=document.createElement("div")
        let box2=document.createElement("div")
        let box3=document.createElement("div")
        let img=document.createElement("img")
        let title=document.createElement("h2")
        let price=document.createElement("h3")
        let btn=document.createElement("button")
        let btn2=document.createElement("button")

        // Assigning Data
        img.src=el.image
        title.innerText=el.title
        price.innerText=el.price
        btn.innerText="Add to Cart"
        btn2.innerText="Add to Wish"

        // Clssess
        box.className="box";
        box3.id="wish";

        //Event Listner

        btn.addEventListener("click",()=>{
            cart.push(el)
            localStorage.setItem("cart",JSON.stringify(cart))
        })
        btn2.addEventListener("click",()=>{
            wish.push(el)
            localStorage.setItem("wish",JSON.stringify(wish))
        })

        // Appending to Main 
        box2.append(img)
        box3.append(btn,btn2)
        box.append(box2,title,price,box3)
        container.append(box)
    });
}
